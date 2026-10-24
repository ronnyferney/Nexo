import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import type { ApiKey } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MIN_ROLE, type WorkspaceRole } from '../decorators/roles.decorator';
import { API_KEY_LAST_USED_GRANULARITY_MS, AuthGuard, type AuthenticatedRequest } from './auth.guard';
import type { SessionCookieService } from './session-cookie.service';
import type { SessionRevocationService } from './session-revocation.service';

const KEY = 'nexo_clave-de-prueba';

function key(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'k1',
    name: 'Integración',
    prefix: 'nexo_clave-d',
    hash: 'h',
    workspaceId: 'w1',
    scopes: ['read'],
    role: 'EDITOR',
    expiresAt: null,
    revokedAt: null,
    revokedReason: null,
    createdById: null,
    lastUsedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

/** Controlador y método simulados con la metadata de rutas que registra Nest. */
function route(controllerPath: string, handlerPath: string, minRole?: WorkspaceRole) {
  class Ctl {}
  const handler = () => undefined;
  Reflect.defineMetadata(PATH_METADATA, controllerPath, Ctl);
  Reflect.defineMetadata(PATH_METADATA, handlerPath, handler);
  if (minRole) Reflect.defineMetadata(MIN_ROLE, minRole, handler);
  return { Ctl, handler };
}

function setup(row: ApiKey | null, creatorRole?: WorkspaceRole | null) {
  const updates: unknown[] = [];
  const prisma = {
    apiKey: {
      findUnique: () => Promise.resolve(row),
      updateMany: (args: unknown) => {
        updates.push(args);
        return Promise.resolve({ count: 1 });
      },
    },
    membership: {
      findUnique: () => Promise.resolve(creatorRole ? { role: creatorRole } : null),
    },
  } as unknown as PrismaService;
  const guard = new AuthGuard(
    new Reflector(),
    {} as JwtService,
    prisma,
    {} as SessionCookieService,
    {} as SessionRevocationService,
  );
  const run = (method: string, r: ReturnType<typeof route>) => {
    const req = { method, headers: { authorization: `Bearer ${KEY}` } } as unknown as AuthenticatedRequest;
    return {
      req,
      result: guard.canActivate({
        getHandler: () => r.handler,
        getClass: () => r.Ctl,
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
      } as unknown as ExecutionContext),
    };
  };
  return { run, updates };
}

describe('AuthGuard con API keys (B3)', () => {
  it('una clave vencida responde 401', async () => {
    const { run } = setup(key({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(run('GET', route('agents', '')).result).rejects.toThrow(UnauthorizedException);
  });

  it('una clave revocada responde 401', async () => {
    const { run } = setup(key({ revokedAt: new Date() }));
    await expect(run('GET', route('agents', '')).result).rejects.toThrow(/revocada/);
  });

  it('una clave inexistente responde 401', async () => {
    const { run } = setup(null);
    await expect(run('GET', route('agents', '')).result).rejects.toThrow(UnauthorizedException);
  });

  it('una acción fuera del alcance responde 403', async () => {
    const { run } = setup(key({ scopes: ['read', 'agents:run'] }));
    await expect(run('POST', route('workflows', ':id/run', 'EDITOR')).result).rejects.toThrow(ForbiddenException);
    await expect(run('POST', route('agents', '')).result).rejects.toThrow(/alcance «write»/);
    await expect(run('POST', route('mcp', '/')).result).rejects.toThrow(/alcance «mcp»/);
    await expect(run('POST', route('agents', ':id/chat')).result).resolves.toBe(true);
    await expect(run('GET', route('workflows', ':id')).result).resolves.toBe(true);
  });

  it('una clave heredada (`*`, rol EDITOR) conserva el comportamiento anterior', async () => {
    const { run } = setup(key({ scopes: ['*'] }));
    await expect(run('POST', route('workflows', ':id/run', 'EDITOR')).result).resolves.toBe(true);
    await expect(run('POST', route('agents', '')).result).resolves.toBe(true);
    await expect(run('POST', route('mcp', '/', 'EDITOR')).result).resolves.toBe(true);
    await expect(run('PUT', route('workspace', 'secrets', 'ADMIN')).result).rejects.toThrow(/Permisos insuficientes/);
  });

  it('el rol efectivo se limita al vigente de quien la creó; si ya no es miembro, 401', async () => {
    const admin = route('workspace', 'secrets', 'ADMIN');
    const degraded = setup(key({ scopes: ['write'], role: 'ADMIN', createdById: 'u1' }), 'EDITOR');
    const { req, result } = degraded.run('PUT', admin);
    await expect(result).rejects.toThrow(/Permisos insuficientes/);
    expect(req.user).toMatchObject({ role: 'EDITOR', via: 'apiKey', apiKeyId: 'k1' });
    await expect(
      setup(key({ scopes: ['write'], role: 'ADMIN', createdById: 'u1' }), 'OWNER').run('PUT', admin).result,
    ).resolves.toBe(true);
    await expect(
      setup(key({ scopes: ['write'], role: 'ADMIN', createdById: 'u1' }), null).run('PUT', admin).result,
    ).rejects.toThrow(/ya no es miembro/);
  });

  it('registra lastUsedAt como mucho una vez por minuto', async () => {
    const fresh = setup(key());
    await fresh.run('GET', route('agents', '')).result;
    expect(fresh.updates).toHaveLength(1);
    const recent = setup(key({ lastUsedAt: new Date(Date.now() - 1000) }));
    await recent.run('GET', route('agents', '')).result;
    expect(recent.updates).toHaveLength(0);
    const old = setup(key({ lastUsedAt: new Date(Date.now() - API_KEY_LAST_USED_GRANULARITY_MS - 1) }));
    await old.run('GET', route('agents', '')).result;
    expect(old.updates).toHaveLength(1);
  });
});
