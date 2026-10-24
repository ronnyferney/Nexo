import type { ApiKey } from '../../../core/models';
import {
  apiKeyExpirationOptions,
  apiKeyRoleOptions,
  apiKeyScopeLabel,
  apiKeyStatusLabel,
  apiKeyWarnings,
} from './api-keys.meta';

const base: ApiKey = {
  id: 'k1',
  name: 'Integración',
  prefix: 'nexo_abc',
  scopes: ['read'],
  role: 'EDITOR',
  legacy: false,
  expiresAt: new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString(),
  status: 'ACTIVE',
  rotationSuggested: false,
  revokedAt: null,
  revokedReason: null,
  lastUsedAt: null,
  createdAt: new Date().toISOString(),
  createdBy: null,
};

describe('API keys (B3)', () => {
  it('el rol de la clave nunca supera el de quien la crea ni llega a OWNER', () => {
    expect(apiKeyRoleOptions('OWNER')).toEqual(['VIEWER', 'EDITOR', 'ADMIN']);
    expect(apiKeyRoleOptions('ADMIN')).toEqual(['VIEWER', 'EDITOR', 'ADMIN']);
    expect(apiKeyRoleOptions('EDITOR')).toEqual(['VIEWER', 'EDITOR']);
  });

  it('«sin expiración» solo se ofrece a un OWNER', () => {
    expect(apiKeyExpirationOptions('OWNER').map((o) => o.value)).toContain('never');
    expect(apiKeyExpirationOptions('ADMIN').map((o) => o.value)).not.toContain('never');
  });

  it('avisa de las claves heredadas, sin expiración o a punto de vencer', () => {
    expect(apiKeyWarnings(base)).toEqual([]);
    expect(apiKeyWarnings({ ...base, legacy: true, scopes: ['*'], expiresAt: null }).length).toBe(
      2,
    );
    expect(apiKeyWarnings({ ...base, expiresAt: null })[0]).toMatch(/Sin expiración/);
    expect(
      apiKeyWarnings({ ...base, expiresAt: new Date(Date.now() + 3600_000).toISOString() })[0],
    ).toMatch(/Vence pronto/);
    expect(apiKeyWarnings({ ...base, status: 'REVOKED', expiresAt: null })).toEqual([]);
  });

  it('etiquetas de alcance y estado', () => {
    expect(apiKeyScopeLabel('*')).toMatch(/heredado/);
    expect(apiKeyScopeLabel('workflows:run')).toBe('Ejecutar flujos');
    expect(
      apiKeyStatusLabel({ ...base, status: 'REVOKED', revokedReason: 'account_takeover' }).text,
    ).toMatch(/cuenta recuperada/);
    expect(apiKeyStatusLabel({ ...base, status: 'EXPIRED' }).tone).toBe('danger');
    expect(apiKeyStatusLabel({ ...base, rotationSuggested: true }).text).toBe('Rotar');
  });
});
