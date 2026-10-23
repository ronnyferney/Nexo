import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { JwtPayload } from '../../common/guards/auth.guard';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('El correo ya está registrado');
    }
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const wsName = dto.workspaceName?.trim() || `Workspace de ${dto.name}`;
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name,
        passwordHash,
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
    return this.issue(user.id, user.memberships[0].workspaceId);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: { memberships: { orderBy: { createdAt: 'asc' }, take: 1 } },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    return this.issue(user.id, user.memberships[0]?.workspaceId);
  }

  /** Cambia la contraseña del usuario autenticado (exige la actual; el usuario maestro debe usarlo al primer ingreso). */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ changed: true }> {
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
      data: { passwordHash: await bcrypt.hash(dto.newPassword, 12) },
    });
    return { changed: true };
  }

  async me(userId: string, workspaceId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
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
    const payload: JwtPayload = { sub: userId, wid: workspaceId, role: membership.role };
    return { accessToken: await this.jwt.signAsync(payload), workspaceId, role: membership.role };
  }
}
