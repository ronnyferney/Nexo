import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import type { AuthContext } from '../decorators/current-user.decorator';
import { IS_PUBLIC, OPTIONAL_AUTH } from '../decorators/public.decorator';
import { MIN_ROLE, ROLE_RANK, type WorkspaceRole } from '../decorators/roles.decorator';
import {
  API_KEY_SCOPE_LABELS,
  apiKeyAllows,
  effectiveApiKeyRole,
  joinRoutePath,
  requiredApiKeyScope,
} from './api-key-scopes';
import { isUnsafeMethod, readCookie, SESSION_COOKIE, SessionCookieService } from './session-cookie.service';
import { SessionRevocationService } from './session-revocation.service';

export const API_KEY_PREFIX = 'nexo_';

/** `lastUsedAt` se actualiza como mucho una vez por minuto y clave: no escribe en cada petición. */
export const API_KEY_LAST_USED_GRANULARITY_MS = 60_000;

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
 *
 * API keys (B3): una clave vencida o revocada responde 401; una acción fuera de su alcance (`api-key-scopes.ts`), 403.
 * Su rol es el menor entre el de la clave y el vigente de quien la creó.
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
      if (credential.token.startsWith(API_KEY_PREFIX)) {
        auth = await this.fromApiKey(credential.token);
        this.assertApiKeyScope(context, req, auth);
      } else {
        auth = await this.fromJwt(credential);
      }
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
    const now = new Date();
    if (key.revokedAt) throw new UnauthorizedException('La API key fue revocada');
    if (key.expiresAt && key.expiresAt <= now) {
      throw new UnauthorizedException('La API key venció; cree una nueva en Ajustes → API keys');
    }
    let role: WorkspaceRole = key.role;
    if (key.createdById) {
      // La clave nunca da más de lo que hoy tiene quien la creó: degradarlo la limita; retirarlo la inhabilita.
      const creator = await this.prisma.membership.findUnique({
        where: { userId_workspaceId: { userId: key.createdById, workspaceId: key.workspaceId } },
        select: { role: true },
      });
      if (!creator) throw new UnauthorizedException('Quien creó la API key ya no es miembro del workspace');
      role = effectiveApiKeyRole(key.role, creator.role);
    }
    if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() >= API_KEY_LAST_USED_GRANULARITY_MS) {
      await this.prisma.apiKey
        .updateMany({
          where: {
            id: key.id,
            OR: [
              { lastUsedAt: null },
              { lastUsedAt: { lt: new Date(now.getTime() - API_KEY_LAST_USED_GRANULARITY_MS) } },
            ],
          },
          data: { lastUsedAt: now },
        })
        .catch(() => undefined);
    }
    return { workspaceId: key.workspaceId, role, via: 'apiKey', apiKeyId: key.id, scopes: key.scopes };
  }

  /** 403 si la acción (método + ruta de Nest) no está dentro del alcance de la clave. */
  private assertApiKeyScope(context: ExecutionContext, req: Request, auth: AuthContext): void {
    const handler = context.getHandler();
    const path = joinRoutePath(
      this.reflector.get<string | string[]>(PATH_METADATA, context.getClass()),
      this.reflector.get<string | string[]>(PATH_METADATA, handler),
    );
    // Se usa el método de la petición (no el del decorador): `@All()` del servidor MCP no fija uno.
    const scope = requiredApiKeyScope(req.method, path);
    if (!apiKeyAllows(auth.scopes ?? [], scope)) {
      throw new ForbiddenException(
        `La API key no tiene el alcance «${scope}» (${API_KEY_SCOPE_LABELS[scope]}) necesario para esta operación`,
      );
    }
  }
}
