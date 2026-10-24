import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'node:crypto';
import type { JwtPayload, SessionCredential } from '../../common/guards/auth.guard';
import { SessionRevocationService } from '../../common/guards/session-revocation.service';
import type { RegistrationMode } from '../../config/configuration';
import { MailService } from '../../infrastructure/mail/mail.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';

/** Vida del enlace de verificación de correo. */
export const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 3600;
const EMAIL_VERIFICATION_AUDIENCE = 'nexo:email-verification';

interface EmailVerificationClaims {
  typ: 'email_verification';
  sub: string;
  email: string;
}

/** Coste de bcrypt de las contraseñas. */
const BCRYPT_ROUNDS = 12;

/**
 * Hash ficticio con el mismo coste que los reales (B4): el login compara contra él cuando el correo no existe, así
 * que tarda lo mismo exista o no la cuenta. Se calcula una vez por proceso, en el primer uso; nadie conoce su
 * contraseña.
 */
let dummyPasswordHash: Promise<string> | undefined;
function dummyHash(): Promise<string> {
  return (dummyPasswordHash ??= bcrypt.hash(randomUUID(), BCRYPT_ROUNDS));
}

/**
 * Respuesta de `POST /auth/register` (B4): idéntica exista o no el correo, para no revelar qué correos tienen cuenta.
 * El registro ya no inicia sesión: la web inicia sesión a continuación con la contraseña elegida.
 */
export const REGISTER_ACCEPTED = {
  accepted: true as const,
  message:
    'Si el correo no tenía cuenta, ya quedó creada: inicie sesión con la contraseña que eligió. Si ya tenía una ' +
    'cuenta, inicie sesión con su contraseña habitual o pida una invitación al administrador de su empresa.',
};

/** Correo tal como se guarda: sin espacios y en minúsculas. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
}

@Injectable()
export class AuthService {
  private readonly registrationMode: RegistrationMode;
  private readonly webUrl: string;
  /** Secreto derivado: un enlace de verificación nunca sirve como token de sesión, y viceversa. */
  private readonly verificationSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly revocations: SessionRevocationService,
    config: ConfigService,
  ) {
    this.registrationMode = config.get<RegistrationMode>('registrationMode') ?? 'open';
    this.webUrl = config.get<string>('webUrl') ?? 'http://localhost:4200';
    this.verificationSecret = createHash('sha256')
      .update(`${config.getOrThrow<string>('jwt.secret')}::email-verification`)
      .digest('hex');
    // Precalcula el hash ficticio: ni el primer login con un correo inexistente tarda distinto.
    void dummyHash();
  }

  /** Datos públicos para la pantalla de inicio de sesión y registro. */
  publicConfig() {
    return { registrationMode: this.registrationMode, mailEnabled: this.mail.enabled };
  }

  /**
   * Registro público (C1): con `REGISTRATION_MODE=invite_only` se rechaza (solo se entra por invitación). Con `open`,
   * la cuenta nace sin verificar: usa su propio workspace, pero no puede unirse a otros sin el token de una invitación.
   *
   * B4: la respuesta y el tiempo son los mismos exista o no el correo (siempre se calcula el hash de la contraseña) y
   * no se emite sesión. Si el correo ya tenía cuenta y hay SMTP, se avisa a su dueño (sin esperar el envío).
   */
  async register(dto: RegisterDto): Promise<typeof REGISTER_ACCEPTED> {
    if (this.registrationMode !== 'open') {
      throw new ForbiddenException(
        'El registro público está cerrado: pida una invitación al administrador de su empresa',
      );
    }
    const email = normalizeEmail(dto.email);
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true, name: true } });
    if (existing) {
      this.notifyExistingAccount(email, existing.name);
      return REGISTER_ACCEPTED;
    }
    try {
      await this.insertAccount(email, dto, passwordHash, { verified: false });
    } catch (err) {
      // Carrera con otro registro del mismo correo (P2002): misma respuesta que si ya existiera.
      if ((err as { code?: string }).code !== 'P2002') throw err;
    }
    return REGISTER_ACCEPTED;
  }

  private notifyExistingAccount(email: string, name: string): void {
    if (!this.mail.enabled) return;
    void this.mail
      .send({
        to: email,
        subject: 'Intento de registro con su correo en Nexo',
        text:
          `Hola, ${name}:\n\nAlguien intentó crear una cuenta en Nexo con este correo, que ya tiene una. Si fue usted, ` +
          `inicie sesión en ${this.webUrl}/login con su contraseña habitual.\n\nSi no fue usted, ignore este mensaje: ` +
          'su cuenta no cambió.',
      })
      .catch(() => undefined);
  }

  /** Crea una cuenta como OWNER de un workspace nuevo. `verified` solo para el usuario maestro del arranque. */
  async createAccount(dto: RegisterDto, opts: { verified: boolean }) {
    const email = normalizeEmail(dto.email);
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('El correo ya está registrado');
    }
    const user = await this.insertAccount(email, dto, await bcrypt.hash(dto.password, BCRYPT_ROUNDS), opts);
    return this.issue(user.id, user.memberships[0].workspaceId);
  }

  private insertAccount(email: string, dto: RegisterDto, passwordHash: string, opts: { verified: boolean }) {
    const wsName = dto.workspaceName?.trim() || `Workspace de ${dto.name}`;
    return this.prisma.user.create({
      data: {
        email,
        name: dto.name,
        passwordHash,
        emailVerifiedAt: opts.verified ? new Date() : null,
        memberships: {
          create: {
            role: 'OWNER',
            workspace: {
              create: {
                name: wsName,
                slug: `${slugify(wsName)}-${Date.now().toString(36)}`,
                orgUnits: { create: { name: wsName } },
              },
            },
          },
        },
      },
      include: { memberships: true },
    });
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(dto.email) },
      include: { memberships: { orderBy: { createdAt: 'asc' }, take: 1 } },
    });
    // Sin cuenta se compara contra el hash ficticio: el tiempo de respuesta no revela si el correo existe (B4).
    const valid = await bcrypt.compare(dto.password, user?.passwordHash ?? (await dummyHash()));
    if (!user || !valid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    return this.issue(user.id, user.memberships[0]?.workspaceId);
  }

  /** Cambia la contraseña del usuario autenticado (exige la actual; el usuario maestro debe usarlo al primer ingreso). */
  /**
   * Cambia la contraseña e invalida las demás sesiones (incrementa `tokenVersion`, B3); devuelve un token nuevo para
   * la sesión actual.
   */
  async changePassword(userId: string, workspaceId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      // 400 y no 401: el interceptor de la web cierra la sesión ante cualquier 401.
      throw new BadRequestException('La contraseña actual no es correcta');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('La nueva contraseña debe ser distinta de la actual');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS), tokenVersion: { increment: 1 } },
    });
    return { changed: true as const, ...(await this.issue(userId, workspaceId)) };
  }

  /** Envía el enlace de verificación al correo de la cuenta (requiere SMTP). */
  async requestEmailVerification(userId: string): Promise<{ sent: boolean; alreadyVerified: boolean }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) return { sent: false, alreadyVerified: true };
    if (!this.mail.enabled) {
      throw new ServiceUnavailableException(
        'El envío de correos no está configurado: pida a un administrador una invitación para verificar su correo',
      );
    }
    const claims: EmailVerificationClaims = { typ: 'email_verification', sub: user.id, email: user.email };
    const token = await this.jwt.signAsync(claims, {
      secret: this.verificationSecret,
      audience: EMAIL_VERIFICATION_AUDIENCE,
      expiresIn: EMAIL_VERIFICATION_TTL_SECONDS,
    });
    const sent = await this.mail.send({
      to: user.email,
      subject: 'Verifique su correo en Nexo',
      text:
        `Hola, ${user.name}:\n\nPara verificar su correo en Nexo, inicie sesión y abra este enlace (vence en 24 horas):\n` +
        `${this.webUrl}/verificar-correo/${token}\n\nSi usted no creó una cuenta en Nexo, ignore este mensaje.`,
    });
    return { sent, alreadyVerified: false };
  }

  /**
   * Confirma el correo. Exige la sesión de esa misma cuenta además del enlace: quien pre-registró un correo ajeno
   * conoce la contraseña pero no recibe el enlace, y el dueño del correo recibe el enlace pero no tiene la sesión.
   */
  async confirmEmailVerification(userId: string, token: string): Promise<{ verified: true }> {
    let claims: EmailVerificationClaims;
    try {
      claims = await this.jwt.verifyAsync<EmailVerificationClaims>(token, {
        secret: this.verificationSecret,
        audience: EMAIL_VERIFICATION_AUDIENCE,
      });
    } catch {
      throw new BadRequestException('El enlace de verificación no es válido o venció');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (claims.typ !== 'email_verification' || claims.sub !== user.id || claims.email !== user.email) {
      throw new ForbiddenException('El enlace de verificación es de otra cuenta');
    }
    if (!user.emailVerifiedAt) {
      await this.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    }
    return { verified: true };
  }

  async me(userId: string, workspaceId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        emailVerifiedAt: true,
        memberships: { select: { role: true, workspace: { select: { id: true, name: true, slug: true } } } },
      },
    });
    return { ...user, activeWorkspaceId: workspaceId };
  }

  async issue(userId: string, workspaceId: string | undefined) {
    if (!workspaceId) throw new ForbiddenException('El usuario no pertenece a ningún workspace');
    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!membership) throw new ForbiddenException('No es miembro de este workspace');
    const { tokenVersion } = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { tokenVersion: true },
    });
    const payload: JwtPayload = { sub: userId, wid: workspaceId, role: membership.role, tv: tokenVersion };
    // `jti`: identifica la sesión para poder cerrarla sola (`POST /auth/logout`).
    const accessToken = await this.jwt.signAsync(payload, { jwtid: randomUUID() });
    return { accessToken, workspaceId, role: membership.role };
  }

  /** Cierra la sesión de esta credencial: su `jti` queda revocado hasta que el token vence (M6). */
  async logout(credential: SessionCredential | undefined): Promise<{ loggedOut: true }> {
    if (credential?.jti) await this.revocations.revoke(credential.jti, credential.exp);
    return { loggedOut: true };
  }
}
