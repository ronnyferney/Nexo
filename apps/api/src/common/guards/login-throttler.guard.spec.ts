import type { ExecutionContext } from '@nestjs/common';
import { ThrottlerException, type ThrottlerStorage } from '@nestjs/throttler';
import { LOGIN_ACCOUNT_LIMIT, LoginAccountThrottlerGuard, normalizeLoginEmail } from './login-throttler.guard';

/** Almacenamiento en memoria con la semántica del limitador: bloquea al superar el límite. */
function memoryStorage(): ThrottlerStorage & { keys: string[] } {
  const hits = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    increment(key, _ttl, limit) {
      keys.push(key);
      const total = (hits.get(key) ?? 0) + 1;
      hits.set(key, total);
      return Promise.resolve({ totalHits: total, timeToExpire: 60, isBlocked: total > limit, timeToBlockExpire: 900 });
    },
  };
}

function ctx(body: unknown, headers: Record<string, unknown> = {}): ExecutionContext {
  const res = { setHeader: (k: string, v: unknown) => (headers[k] = v) };
  return { switchToHttp: () => ({ getRequest: () => ({ body }), getResponse: () => res }) } as ExecutionContext;
}

describe('LoginAccountThrottlerGuard (A5)', () => {
  it('normaliza el correo como lo busca el login', () => {
    expect(normalizeLoginEmail('  Ana@Empresa.COM ')).toBe('ana@empresa.com');
    expect(normalizeLoginEmail(42)).toBeNull();
    expect(normalizeLoginEmail('   ')).toBeNull();
  });

  it('bloquea una cuenta tras el límite aunque cambien mayúsculas y espacios, sin afectar a otras cuentas', async () => {
    const storage = memoryStorage();
    const guard = new LoginAccountThrottlerGuard(storage);
    for (let i = 0; i < LOGIN_ACCOUNT_LIMIT; i++) {
      await expect(guard.canActivate(ctx({ email: i % 2 ? 'VICTIMA@nexo.test ' : 'victima@nexo.test' }))).resolves.toBe(
        true,
      );
    }
    const headers: Record<string, unknown> = {};
    await expect(guard.canActivate(ctx({ email: 'Victima@Nexo.test' }, headers))).rejects.toBeInstanceOf(
      ThrottlerException,
    );
    expect(headers['Retry-After']).toBe(900);
    await expect(guard.canActivate(ctx({ email: 'otra@nexo.test' }))).resolves.toBe(true);
    // La clave es un hash: el correo no se guarda en Redis.
    expect(storage.keys.every((k) => /^[0-9a-f]{64}$/.test(k) && !k.includes('victima'))).toBe(true);
  });

  it('sin correo válido deja que la validación del DTO responda', async () => {
    const storage = memoryStorage();
    await expect(new LoginAccountThrottlerGuard(storage).canActivate(ctx({}))).resolves.toBe(true);
    expect(storage.keys).toEqual([]);
  });
});
