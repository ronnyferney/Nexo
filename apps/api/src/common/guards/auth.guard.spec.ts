import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { IS_PUBLIC, OPTIONAL_AUTH } from '../decorators/public.decorator';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard';
import { SessionCookieService } from './session-cookie.service';
import type { SessionRevocationService } from './session-revocation.service';

const TOKEN = 'header.payload.firma';

function setup(opts: { optional?: boolean; revoked?: boolean; tokenVersion?: number; validJwt?: boolean } = {}) {
  const cookies = new SessionCookieService({
    get: () => false,
    getOrThrow: () => 'secreto-de-jwt-de-la-prueba-0123456789',
  } as unknown as ConfigService);
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === OPTIONAL_AUTH ? !!opts.optional : key === IS_PUBLIC ? false : undefined,
  } as unknown as Reflector;
  const jwt = {
    verifyAsync: () =>
      opts.validJwt === false
        ? Promise.reject(new Error('jwt expired'))
        : Promise.resolve({ sub: 'u1', wid: 'w1', role: 'OWNER', tv: 0, jti: 'j1', exp: 2_000_000_000 }),
  } as unknown as JwtService;
  const prisma = {
    membership: {
      findUnique: () => Promise.resolve({ role: 'EDITOR', user: { tokenVersion: opts.tokenVersion ?? 0 } }),
    },
  } as unknown as PrismaService;
  const revocations = { isRevoked: () => Promise.resolve(!!opts.revoked) } as unknown as SessionRevocationService;
  const guard = new AuthGuard(reflector, jwt, prisma, cookies, revocations);
  const cleared: string[] = [];
  const res = { clearCookie: (name: string) => cleared.push(name) };
  const run = (req: Partial<AuthenticatedRequest>) =>
    guard.canActivate({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext);
  return { cookies, run, cleared };
}

const cookieReq = (method: string, extra: Record<string, string> = {}) =>
  ({ method, headers: { cookie: `otra=1; nexo_session=${TOKEN}`, ...extra } }) as unknown as AuthenticatedRequest;

describe('AuthGuard con la cookie de sesión (M6)', () => {
  it('acepta la cookie en lecturas sin CSRF y deja la credencial en la petición', async () => {
    const { run } = setup();
    const req = cookieReq('GET');
    await expect(run(req)).resolves.toBe(true);
    expect(req.user).toMatchObject({ userId: 'u1', workspaceId: 'w1', role: 'EDITOR', via: 'jwt' });
    expect(req.sessionCredential).toMatchObject({ source: 'cookie', jti: 'j1', exp: 2_000_000_000 });
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s con la cookie exige el X-CSRF-Token de esa sesión', async (m) => {
    const { run, cookies } = setup();
    await expect(run(cookieReq(m))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run(cookieReq(m, { 'x-csrf-token': cookies.csrfTokenFor('otro.token.x') }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(run(cookieReq(m, { 'x-csrf-token': cookies.csrfTokenFor(TOKEN) }))).resolves.toBe(true);
  });

  it('con Authorization: Bearer no exige CSRF (y la cabecera manda sobre la cookie)', async () => {
    const { run } = setup();
    const req = { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, cookie: 'nexo_session=x' } };
    await expect(run(req as unknown as AuthenticatedRequest)).resolves.toBe(true);
    expect((req as AuthenticatedRequest).sessionCredential).toMatchObject({ source: 'header', token: TOKEN });
  });

  it('una sesión revocada por logout responde 401 y borra las cookies', async () => {
    const { run, cleared } = setup({ revoked: true });
    await expect(run(cookieReq('GET'))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(cleared).toEqual(['nexo_session', 'nexo_csrf']);
  });

  it('tokenVersion distinto (contraseña cambiada) invalida la cookie', async () => {
    const { run } = setup({ tokenVersion: 3 });
    await expect(run(cookieReq('GET'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('una API key en la cookie no se acepta', async () => {
    const { run } = setup();
    const req = { method: 'GET', headers: { cookie: 'nexo_session=nexo_abc' } } as unknown as AuthenticatedRequest;
    await expect(run(req)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('en un endpoint con auth opcional, una cookie inválida se ignora (anónimo) y se borra', async () => {
    const { run, cleared } = setup({ optional: true, validJwt: false });
    const req = cookieReq('POST');
    await expect(run(req)).resolves.toBe(true);
    expect(req.user).toBeUndefined();
    expect(cleared).toContain('nexo_session');
  });

  it('en un endpoint con auth opcional, una cookie válida sin CSRF responde 403', async () => {
    const { run } = setup({ optional: true });
    await expect(run(cookieReq('POST'))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('SessionCookieService', () => {
  const make = (secure: boolean) =>
    new SessionCookieService({
      get: () => secure,
      getOrThrow: () => 'secreto-de-jwt-de-la-prueba-0123456789',
    } as unknown as ConfigService);

  it('emite las cookies con Secure cuando está configurado y la vida del token', () => {
    const calls: [string, string, Record<string, unknown>][] = [];
    const res = { cookie: (n: string, v: string, o: Record<string, unknown>) => calls.push([n, v, o]) };
    const exp = Math.floor(Date.now() / 1000) + 600;
    const token = `x.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.y`;
    make(true).set(res as never, token);
    expect(calls[0]).toEqual([
      'nexo_session',
      token,
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'strict', path: '/api' }),
    ]);
    expect(calls[0][2].maxAge).toBeGreaterThan(590_000);
    expect(calls[0][2].maxAge).toBeLessThanOrEqual(600_000);
    expect(calls[1]).toEqual([
      'nexo_csrf',
      make(true).csrfTokenFor(token),
      expect.objectContaining({ httpOnly: false, secure: true, sameSite: 'strict', path: '/' }),
    ]);
  });

  it('el token CSRF depende de la sesión y del secreto', () => {
    expect(make(false).csrfTokenFor('a')).not.toBe(make(false).csrfTokenFor('b'));
    const other = new SessionCookieService({
      get: () => false,
      getOrThrow: () => 'otro-secreto-de-jwt-0123456789abcdef',
    } as unknown as ConfigService);
    expect(other.csrfTokenFor('a')).not.toBe(make(false).csrfTokenFor('a'));
  });
});
