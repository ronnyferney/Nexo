import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthContext } from '../../../common/decorators/current-user.decorator';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Rol de plataforma (ADR 0006 D6): administradores de Nexo definidos por `PLATFORM_ADMIN_EMAILS`. No es un rol de
 * workspace; requiere sesión de usuario (no API keys). Se ejecuta después del AuthGuard global.
 */
@Injectable()
export class PlatformAdminService {
  private readonly emails: Set<string>;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.emails = new Set(config.get<string[]>('platform.adminEmails') ?? []);
  }

  async isPlatformAdmin(auth: AuthContext | undefined): Promise<boolean> {
    if (!auth?.userId || !this.emails.size) return false;
    const user = await this.prisma.user.findUnique({ where: { id: auth.userId }, select: { email: true } });
    return !!user && this.emails.has(user.email.trim().toLowerCase());
  }
}

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly admins: PlatformAdminService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const auth = context.switchToHttp().getRequest<{ user?: AuthContext }>().user;
    if (!(await this.admins.isPlatformAdmin(auth))) {
      throw new ForbiddenException('Solo los administradores de la plataforma Nexo pueden acceder a esta consola');
    }
    return true;
  }
}
