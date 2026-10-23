import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import type { AuthContext } from '../decorators/current-user.decorator';
import { IS_PUBLIC } from '../decorators/public.decorator';
import { MIN_ROLE, ROLE_RANK, type WorkspaceRole } from '../decorators/roles.decorator';

export const API_KEY_PREFIX = 'nexo_';

export interface JwtPayload {
  sub: string;
  wid: string;
  role: WorkspaceRole;
}

/**
 * Guard global: acepta `Authorization: Bearer <jwt>` (usuarios) o
 * `Bearer nexo_...` / `x-api-key` (integraciones). Aplica control de rol mínimo.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.headers['x-api-key'] as string | undefined);
    if (!token) throw new UnauthorizedException('Credenciales requeridas');

    const auth = token.startsWith(API_KEY_PREFIX) ? await this.fromApiKey(token) : await this.fromJwt(token);
    req.user = auth;

    const minRole = this.reflector.getAllAndOverride<WorkspaceRole>(MIN_ROLE, targets);
    if (minRole && ROLE_RANK[auth.role] < ROLE_RANK[minRole]) {
      throw new ForbiddenException('Permisos insuficientes para esta operación');
    }
    return true;
  }

  private async fromJwt(token: string): Promise<AuthContext> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
    // El rol vigente se toma de la membresía, no del token: degradar o retirar a un miembro aplica de inmediato.
    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: payload.sub, workspaceId: payload.wid } },
      select: { role: true },
    });
    if (!membership) throw new UnauthorizedException('Ya no es miembro de este workspace');
    return { userId: payload.sub, workspaceId: payload.wid, role: membership.role, via: 'jwt' };
  }

  private async fromApiKey(token: string): Promise<AuthContext> {
    const key = await this.prisma.apiKey.findUnique({ where: { hash: CryptoService.sha256(token) } });
    if (!key) throw new UnauthorizedException('API key inválida');
    void this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    return { workspaceId: key.workspaceId, role: 'EDITOR', via: 'apiKey' };
  }
}
