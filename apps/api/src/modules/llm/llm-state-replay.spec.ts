import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CryptoService } from '../../common/crypto/crypto.service';
import type { ReplayGuard } from '../../infrastructure/redis/single-use.service';
import { OAuthStateService, STATE_REPLAY_SCOPE } from '../oauth/oauth-state.service';

const JWT_SECRET = 'unit-jwt-secret-0123456789abcdef0123456789abcdef';
const cfg = new ConfigService({
  jwt: { secret: JWT_SECRET },
  encryptionKey: '0f1e2d3c4b5a69788796a5b4c3d2e1f000112233445566778899aabbccddeeff',
});
const payload = {
  workspaceId: 'ws1',
  connectorId: 'llm-provider:openrouter:tag',
  userId: 'u1',
  codeVerifier: 'v'.repeat(43),
};

/** Almacén compartido entre «instancias» (como Redis con SET NX PX). */
function sharedGuard(): ReplayGuard & { claims: string[] } {
  const seen = new Set<string>();
  const claims: string[] = [];
  return {
    claims,
    claim: async (scope, id, ttl) => {
      claims.push(`${scope}:${id}:${ttl > 0 && ttl <= 600_000}`);
      if (seen.has(`${scope}:${id}`)) return false;
      seen.add(`${scope}:${id}`);
      return true;
    },
  };
}

describe('Uso único del state OAuth de proveedores IA entre réplicas (B2)', () => {
  const newInstance = () => new OAuthStateService(new JwtService({ secret: JWT_SECRET }), new CryptoService(cfg), cfg);

  it('sin guard, el replay en otra instancia pasaba (memoria por instancia): es el hallazgo B2', async () => {
    const a = newInstance();
    const b = newInstance();
    const state = await a.sign(payload);
    await expect(a.consume(state)).resolves.not.toBeNull();
    await expect(b.consume(state)).resolves.not.toBeNull();
  });

  it('con el guard compartido, el replay en otra instancia se rechaza', async () => {
    const guard = sharedGuard();
    const a = newInstance();
    const b = newInstance();
    const state = await a.sign(payload);
    await expect(a.consume(state, { replayGuard: guard })).resolves.toMatchObject({ workspaceId: 'ws1' });
    await expect(b.consume(state, { replayGuard: guard })).resolves.toBeNull();
    // Se reclama el jti con un TTL acotado a la vida del state.
    expect(guard.claims[0]).toMatch(new RegExp(`^${STATE_REPLAY_SCOPE}:[\\w-]+:true$`));
  });

  it('falla cerrado: si el almacén no confirma, el state se rechaza', async () => {
    const down: ReplayGuard = { claim: async () => false };
    const svc = newInstance();
    await expect(svc.consume(await svc.sign(payload), { replayGuard: down })).resolves.toBeNull();
  });

  it('un state inválido o expirado no llega a reclamar el jti', async () => {
    const guard = sharedGuard();
    const svc = newInstance();
    await expect(svc.consume('basura', { replayGuard: guard })).resolves.toBeNull();
    await expect(svc.consume(await svc.sign(payload, -5), { replayGuard: guard })).resolves.toBeNull();
    expect(guard.claims).toHaveLength(0);
  });
});
