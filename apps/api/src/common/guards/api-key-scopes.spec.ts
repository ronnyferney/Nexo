import {
  apiKeyAllows,
  apiKeyExpiresAt,
  effectiveApiKeyRole,
  joinRoutePath,
  LEGACY_FULL_SCOPE,
  requiredApiKeyScope,
} from './api-key-scopes';

describe('Alcances de API keys (B3)', () => {
  it.each([
    ['GET', 'agents', 'read'],
    ['HEAD', 'workflows/:id', 'read'],
    ['POST', 'agents/:id/chat', 'agents:run'],
    ['POST', 'routines/:id/run', 'agents:run'],
    ['POST', 'workflows/:id/run', 'workflows:run'],
    ['POST', 'executions/:id/retry', 'workflows:run'],
    ['POST', 'executions/:id/cancel', 'workflows:run'],
    ['POST', 'connectors/:id/operations/:opId/invoke', 'connectors:invoke'],
    ['POST', 'knowledge-bases/:id/search', 'read'],
    ['POST', 'mcp', 'mcp'],
    ['GET', 'mcp', 'mcp'],
    ['DELETE', 'mcp', 'mcp'],
    ['POST', 'agents', 'write'],
    ['PATCH', 'workflows/:id', 'write'],
    ['DELETE', 'connectors/:id', 'write'],
    ['POST', 'workflows/:id/nodes/:nodeId/test', 'write'],
    ['PUT', 'workspace/secrets', 'write'],
    ['POST', 'mcpx', 'write'],
  ])('%s %s exige «%s»', (method, path, scope) => {
    expect(requiredApiKeyScope(method, path)).toBe(scope);
  });

  it('une la ruta del controlador y la del método como las registra Nest', () => {
    expect(joinRoutePath('workflows', ':id/run')).toBe('workflows/:id/run');
    expect(joinRoutePath('mcp', '/')).toBe('mcp');
    expect(joinRoutePath('/', '/health')).toBe('health');
    expect(joinRoutePath(['agents', 'x'], undefined)).toBe('agents');
  });

  it('el alcance heredado `*` permite todo; los demás, solo lo suyo', () => {
    expect(apiKeyAllows([LEGACY_FULL_SCOPE], 'write')).toBe(true);
    expect(apiKeyAllows(['read', 'agents:run'], 'agents:run')).toBe(true);
    expect(apiKeyAllows(['read', 'agents:run'], 'write')).toBe(false);
    expect(apiKeyAllows([], 'read')).toBe(false);
  });

  it('el rol efectivo nunca supera el vigente de quien creó la clave', () => {
    expect(effectiveApiKeyRole('ADMIN', 'EDITOR')).toBe('EDITOR');
    expect(effectiveApiKeyRole('EDITOR', 'OWNER')).toBe('EDITOR');
    expect(effectiveApiKeyRole('VIEWER', 'ADMIN')).toBe('VIEWER');
    expect(effectiveApiKeyRole('EDITOR')).toBe('EDITOR');
  });

  it('expiración: 30/90/365 días o ninguna', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(apiKeyExpiresAt('30d', now)?.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(apiKeyExpiresAt('90d', now)?.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(apiKeyExpiresAt('365d', now)?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(apiKeyExpiresAt('never', now)).toBeNull();
  });
});
