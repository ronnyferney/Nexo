import type { LlmConnection, LlmModel } from '@prisma/client';

const num = (d: { toString(): string } | null) => (d === null ? null : Number(d));

export function serializeModel(m: LlmModel) {
  return {
    id: m.id,
    connectionId: m.connectionId,
    modelId: m.modelId,
    label: m.label,
    tier: m.tier,
    inputUsdPerMTok: num(m.inputUsdPerMTok),
    outputUsdPerMTok: num(m.outputUsdPerMTok),
    cacheReadUsdPerMTok: num(m.cacheReadUsdPerMTok),
    /** Especialidades verificadas (CODE | REASONING | VISION | FAST | GENERAL); GENERAL si no hay datos. */
    specialties: m.specialties?.length ? m.specialties : ['GENERAL'],
    /** Ventana de contexto en tokens; null si no está verificada. */
    contextTokens: m.contextTokens ?? null,
    enabled: m.enabled,
    /** Importado sin tarifa verificada: la consola debe pedir completarla. */
    needsPricing: m.needsPricing,
  };
}

/** Valores no secretos del formulario del catálogo (nunca la clave). */
function providerFields(c: LlmConnection): Record<string, string> {
  const raw = c.providerFields;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
}

export function serializeConnection(c: LlmConnection & { models?: LlmModel[] }) {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    baseUrl: c.baseUrl,
    hasApiKey: !!c.apiKeyCipher,
    /** API_KEY (clave estática) u OAUTH (token renovable; `oauthExpiresAt` = vencimiento del access token actual). */
    credentialType: c.credentialType,
    oauthExpiresAt: c.oauthExpiresAt ?? null,
    /** El token OAuth se renueva solo (hay refresh token); si es false, al expirar hay que volver a iniciar sesión. */
    oauthRenewable: c.credentialType === 'OAUTH' ? !!c.oauthRefreshCipher : null,
    /** Conexión OAuth con la sesión cerrada (sin tokens): conserva modelos y agentes hasta volver a iniciar sesión. */
    signedOut: c.credentialType === 'OAUTH' && !c.apiKeyCipher,
    enabled: c.enabled,
    /** Entrada del catálogo de proveedores; null en conexiones manuales. */
    providerId: c.providerId,
    providerFields: providerFields(c),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    models: (c.models ?? []).map(serializeModel),
  };
}
