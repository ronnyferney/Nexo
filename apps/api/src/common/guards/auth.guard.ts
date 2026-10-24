import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import type { AuthContext } from '../decorators/current-user.decorator';
import { IS_PUBLIC, OPTIONAL_AUTH } from '../decorators/public.decorator';
import { MIN_ROLE, ROLE_RANK, type WorkspaceRole } from '../decorators/roles.decorator';
import { isUnsafeMethod, readCookie, SESSION_COOKIE, SessionCookieService } from './session-cookie.service';
import { SessionRevocationService } from './session-revocation.service';

export const API_KEY_PREFIX = 'nexo_';

export interface JwtPayload {
  sub: string;
  wid: string;
  role: WorkspaceRole;
  /** `User.tokenVersion` al emitirlo; si cambió (cuenta recuperada, contraseña cambiada), el token deja de valer. */
  tv?: number;
  /** Identificador de la sesión (`POST /auth/logout` lo revoca). Los tokens anteriores no lo traen. */
  jti?: string;
  exp?: number;
}

/** Credencial con la que llegó la petición; `POST /auth/logout` y `GET /auth/me` la consultan. */
export interface SessionCredential {
  token: string;
  /** `cookie`: sesión de la web (`nexo_session`); `header`: `Authorization: Bearer` o `x-api-key`. */
  source: 'cookie' | 'header';
  jti?: string;
  exp?: number;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthContext;
  sessionCredential?: SessionCredential;
}

/**
 * Guard global: acepta `Authorization: Bearer <jwt>` (usuarios), `Bearer nexo_...` / `x-api-key` (integraciones y
 * clientes MCP) y, sin cabecera, la cookie de sesión de la web `nexo_session` (M6). Con la cookie, las peticiones que
 * modifican datos exigen el token CSRF (`X-CSRF-Token`, ver `SessionCookieService`). Aplica control de rol mínimo.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly cookies: SessionCookieService,
    private readonly revocations: SessionRevocationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const optional = !!this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH, targets);

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header: string | undefined = req.headers.authorization;
    const headerToken = header?.startsWith('Bearer ')
      ? header.slice(7)
      : (req.headers['x-api-key'] as string | undefined);
    const credential: SessionCredential | undefined = headerToken
      ? { token: headerToken, source: 'header' }
      : (() => {
          const cookie = readCookie(req, SESSION_COOKIE);
          return cookie ? { token: cookie, source: 'cookie' as const } : undefined;
        })();
    if (!credential) {
      if (optional) return true;
      throw new UnauthorizedException('Credenciales requeridas');
    }

    let auth: AuthContext;
    if (credential.source === 'cookie') {
      try {
        // La cookie solo transporta sesiones de usuario: una API key nunca viaja como credencial ambiental.
        if (credential.token.startsWith(API_KEY_PREFIX)) throw new UnauthorizedException('Sesión inválida');
        auth = await this.fromJwt(credential);
      } catch (err) {
        // Cookie vencida o revocada: se borra para que el navegador no la siga enviando.
        this.cookies.clear(context.switchToHttp().getResponse<Response>());
        if (optional && err instanceof UnauthorizedException) return true;
        throw err;
      }
      if (isUnsafeMethod(req.method) && !this.cookies.csrfMatches(req, credential.token)) {
        throw new ForbiddenException('Falta el token CSRF o no corresponde a la sesión; recargue la página');
      }
    } else {
      auth = credential.token.startsWith(API_KEY_PREFIX)
        ? await this.fromApiKey(credential.token)
        : await this.fromJwt(credential);
    }
    req.user = auth;
    req.sessionCredential = credential;

    const minRole = this.reflector.getAllAndOverride<WorkspaceRole>(MIN_ROLE, targets);
    if (minRole && ROLE_RANK[auth.role] < ROLE_RANK[minRole]) {
      throw new ForbiddenException('Permisos insuficientes para esta operación');
    }
    return true;
  }

  private async fromJwt(credential: SessionCredential): Promise<AuthContext> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(credential.token);
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
    // El rol vigente se toma de la membresía, no del token: degradar o retirar a un miembro aplica de inmediato.
    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: payload.sub, workspaceId: payload.wid } },
      select: { role: true, user: { select: { tokenVersion: true } } },
    });
    if (!membership) throw new UnauthorizedException('Ya no es miembro de este workspace');
    // Tokens anteriores a `tv` equivalen a la versión 0.
    if ((payload.tv ?? 0) !== membership.user.tokenVersion) {
      throw new UnauthorizedException('La sesión ya no es válida; inicie sesión de nuevo');
    }
    if (payload.jti && (await this.revocations.isRevoked(payload.jti))) {
      throw new UnauthorizedException('La sesión se cerró; inicie sesión de nuevo');
    }
    credential.jti = payload.jti;
    credential.exp = payload.exp;
    return { userId: payload.sub, workspaceId: payload.wid, role: membership.role, via: 'jwt' };
  }

  private async fromApiKey(token: string): Promise<AuthContext> {
    const key = await this.prisma.apiKey.findUnique({ where: { hash: CryptoService.sha256(token) } });
    if (!key) throw new UnauthorizedException('API key inválida');
    void this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    return { workspaceId: key.workspaceId, role: 'EDITOR', via: 'apiKey' };
  }
}
