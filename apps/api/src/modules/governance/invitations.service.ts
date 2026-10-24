import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Invitation, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { CryptoService } from '../../common/crypto/crypto.service';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { maskEmail, MailService } from '../../infrastructure/mail/mail.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthService, normalizeEmail } from '../auth/auth.service';
import type { MemberActor } from './org.service';

/** Vida de una invitación. */
export const INVITATION_TTL_MS = 7 * 24 * 3600 * 1000;
const TOKEN_PREFIX = 'inv_';

export interface InvitationInput {
  email: string;
  name?: string;
  role: Role;
  orgUnitId?: string;
}

export interface AcceptInvitationInput {
  name?: string;
  password?: string;
}

export type InvitationStatus = 'PENDING' | 'EXPIRED' | 'ACCEPTED' | 'REVOKED';

function statusOf(inv: Pick<Invitation, 'acceptedAt' | 'revokedAt' | 'expiresAt'>, now = new Date()): InvitationStatus {
  if (inv.acceptedAt) return 'ACCEPTED';
  if (inv.revokedAt) return 'REVOKED';
  return inv.expiresAt <= now ? 'EXPIRED' : 'PENDING';
}

/**
 * Invitaciones a un workspace (auditoría C1). Nunca se une a un workspace una cuenta cuyo dueño no demostró controlar
 * el correo: la membresía se crea solo al aceptar con el token de un solo uso que recibe ese correo.
 *
 * Al aceptar:
 * - sin cuenta: se crea con la contraseña que elige la persona, con el correo verificado;
 * - cuenta verificada: hay que haber iniciado sesión como ese usuario (el token solo no basta);
 * - cuenta SIN verificar (posible cuenta pre-creada por otra persona): el token demuestra el control del correo, así que
 *   la persona fija una contraseña nueva, el correo queda verificado y se invalidan todas las sesiones anteriores.
 */
@Injectable()
export class InvitationsService {
  private readonly webUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    this.webUrl = config.get<string>('webUrl') ?? 'http://localhost:4200';
  }

  /**
   * Crea la invitación (revoca la activa anterior para el mismo correo) y devuelve el enlace de aceptación UNA sola
   * vez: solo se guarda su hash. Si hay SMTP, además se envía por correo.
   */
  async create(workspaceId: string, input: InvitationInput, actor: MemberActor) {
    const email = normalizeEmail(input.email);
    if (input.orgUnitId) {
      const unit = await this.prisma.orgUnit.findFirst({ where: { id: input.orgUnitId, workspaceId } });
      if (!unit) throw new NotFoundException('Unidad no encontrada');
    }
    const member = await this.prisma.membership.findFirst({ where: { workspaceId, user: { email } } });
    if (member) throw new ConflictException('El usuario ya es miembro de este workspace');

    const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const invitation = await this.prisma.$transaction(async (tx) => {
      // Serializa las invitaciones del workspace: una sola activa por correo.
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;
      await tx.invitation.updateMany({
        where: { workspaceId, email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return tx.invitation.create({
        data: {
          workspaceId,
          email,
          name: input.name?.trim() || null,
          role: input.role,
          orgUnitId: input.orgUnitId ?? null,
          tokenHash: CryptoService.sha256(token),
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          invitedById: actor.userId ?? null,
        },
        include: { workspace: { select: { name: true } }, invitedBy: { select: { name: true, email: true } } },
      });
    });

    const acceptUrl = `${this.webUrl}/invitacion/${token}`;
    const inviter = invitation.invitedBy?.name ?? 'Un administrador';
    const emailSent = await this.mail.send({
      to: email,
      subject: `Invitación a ${invitation.workspace.name} en Nexo`,
      text:
        `Hola${invitation.name ? `, ${invitation.name}` : ''}:\n\n${inviter} le invitó a unirse a ` +
        `«${invitation.workspace.name}» en Nexo. Para aceptar, abra este enlace (vence en 7 días):\n${acceptUrl}\n\n` +
        'Si no esperaba esta invitación, ignore este mensaje.',
    });
    return { invitation: this.view(invitation), acceptUrl, emailSent };
  }

  /** Invitaciones sin aceptar ni revocar (pendientes y vencidas), más recientes primero. */
  async list(workspaceId: string) {
    const rows = await this.prisma.invitation.findMany({
      where: { workspaceId, acceptedAt: null, revokedAt: null },
      include: { invitedBy: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.view(r));
  }

  async revoke(workspaceId: string, id: string, actor: MemberActor) {
    const inv = await this.prisma.invitation.findFirst({ where: { id, workspaceId } });
    if (!inv) throw new NotFoundException('Invitación no encontrada');
    if (inv.role === 'OWNER' && actor.role !== 'OWNER') {
      throw new ForbiddenException('Solo un OWNER puede revocar una invitación con rol OWNER');
    }
    if (inv.acceptedAt) throw new ConflictException('La invitación ya fue aceptada');
    if (!inv.revokedAt) await this.prisma.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
    return { revoked: true };
  }

  /** Datos mínimos para la página pública de la invitación. */
  async preview(token: string) {
    const inv = await this.findUsable(token);
    const user = await this.prisma.user.findUnique({
      where: { email: inv.email },
      select: { emailVerifiedAt: true },
    });
    return {
      workspaceName: inv.workspace.name,
      email: maskEmail(inv.email),
      name: inv.name,
      role: inv.role,
      expiresAt: inv.expiresAt,
      accountExists: !!user,
      /** La cuenta existe y está verificada: hay que iniciar sesión con ella para aceptar. */
      requiresLogin: !!user?.emailVerifiedAt,
    };
  }

  async accept(token: string, input: AcceptInvitationInput, auth?: AuthContext) {
    const inv = await this.findUsable(token);
    const now = new Date();
    // bcrypt fuera de la transacción: no retiene el bloqueo de filas mientras calcula.
    const passwordHash = input.password ? await bcrypt.hash(input.password, 12) : null;
    const result = await this.prisma.$transaction(async (tx) => {
      // Consumo atómico: dos aceptaciones simultáneas del mismo enlace no crean dos cuentas ni dos membresías.
      const consumed = await tx.invitation.updateMany({
        where: { id: inv.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { acceptedAt: now },
      });
      if (!consumed.count) throw new GoneException('La invitación ya se usó, venció o fue revocada');

      let user = await tx.user.findUnique({ where: { email: inv.email } });
      let sessionsRevoked = false;
      if (!user) {
        const name = input.name?.trim() || inv.name;
        if (!passwordHash) throw new BadRequestException('Elija una contraseña para crear su cuenta');
        if (!name || name.length < 2) throw new BadRequestException('Indique su nombre');
        user = await tx.user.create({
          data: {
            email: inv.email,
            name,
            passwordHash,
            emailVerifiedAt: now,
          },
        });
      } else if (user.emailVerifiedAt) {
        if (!auth?.userId) {
          throw new ForbiddenException(
            `Inicie sesión con la cuenta ${maskEmail(inv.email)} para aceptar la invitación`,
          );
        }
        if (auth.userId !== user.id) throw new ForbiddenException('La invitación es para otra cuenta');
      } else {
        // Cuenta sin verificar: quien la creó pudo no ser el dueño del correo. El token demuestra el control del
        // correo: contraseña nueva, correo verificado y fuera todas las sesiones anteriores.
        if (!passwordHash) {
          throw new BadRequestException('Elija una contraseña nueva para tomar el control de su cuenta');
        }
        user = await tx.user.update({
          where: { id: user.id },
          data: {
            passwordHash,
            emailVerifiedAt: now,
            tokenVersion: { increment: 1 },
            ...(input.name?.trim() ? { name: input.name.trim() } : {}),
          },
        });
        sessionsRevoked = true;
      }

      const existing = await tx.membership.findUnique({
        where: { userId_workspaceId: { userId: user.id, workspaceId: inv.workspaceId } },
      });
      const membership =
        existing ??
        (await tx.membership.create({
          data: { userId: user.id, workspaceId: inv.workspaceId, role: inv.role, orgUnitId: inv.orgUnitId },
        }));
      await tx.invitation.update({ where: { id: inv.id }, data: { acceptedById: user.id } });
      return { userId: user.id, membershipId: membership.id, sessionsRevoked };
    });
    const session = await this.auth.issue(result.userId, inv.workspaceId);
    return { ...session, ...result };
  }

  /** Invitación vigente por token: 404 si no existe; 410 si se usó, venció o se revocó. */
  private async findUsable(token: string) {
    if (!token?.startsWith(TOKEN_PREFIX)) throw new NotFoundException('Invitación no encontrada');
    const inv = await this.prisma.invitation.findUnique({
      where: { tokenHash: CryptoService.sha256(token) },
      include: { workspace: { select: { name: true } } },
    });
    if (!inv) throw new NotFoundException('Invitación no encontrada');
    if (statusOf(inv) !== 'PENDING') throw new GoneException('La invitación ya se usó, venció o fue revocada');
    return inv;
  }

  private view(inv: Invitation & { invitedBy?: { name: string; email: string } | null }) {
    return {
      id: inv.id,
      email: inv.email,
      name: inv.name,
      role: inv.role,
      orgUnitId: inv.orgUnitId,
      status: statusOf(inv),
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
      invitedBy: inv.invitedBy ? { name: inv.invitedBy.name, email: inv.invitedBy.email } : null,
    };
  }
}
