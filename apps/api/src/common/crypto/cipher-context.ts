/**
 * Contexto de cifrado (AAD de AES-256-GCM, auditoría B7). Liga cada valor cifrado al lugar donde vive: un texto
 * cifrado copiado a otra fila, a otro campo o a otro workspace deja de descifrarse aunque la clave sea la misma.
 *
 * Reglas para elegir el contexto:
 * - Solo datos **inmutables** de la fila (workspace, nombre de un secreto, conector dueño de un token, `jti`), nunca
 *   algo que cambie con una edición: un contexto distinto al leer hace que el valor no se pueda descifrar.
 * - El mismo contexto al cifrar y al descifrar. `crypto:rotate` reconstruye el contexto de cada fila con estas mismas
 *   funciones: cualquier contexto nuevo debe agregarse también en `crypto-rotation.ts`.
 */
export interface CipherContext {
  /** Tipo y campo del valor, p. ej. `secret.value` o `llm-connection.api-key`. */
  purpose: CipherPurpose;
  /** Workspace dueño del valor (siempre que exista). */
  workspaceId: string;
  /** Identificadores inmutables adicionales (nombre del secreto, conector, `jti`). */
  ids?: string[];
}

export type CipherPurpose =
  | 'secret.value'
  | 'llm-connection.api-key'
  | 'llm-connection.oauth-refresh'
  | 'llm-auth-flow.device-code'
  | 'llm-auth-flow.pending-tokens'
  | 'oauth-credential.access-token'
  | 'oauth-credential.refresh-token'
  | 'oauth-state.code-verifier'
  | 'platform-oauth-app.client-secret';

/** Serialización canónica del contexto (JSON: sin ambigüedad aunque un nombre contenga separadores). */
export function serializeContext(ctx: CipherContext): string {
  return JSON.stringify([ctx.purpose, ctx.workspaceId, ...(ctx.ids ?? [])]);
}

/** Constructores de contexto por campo cifrado: un solo lugar para cifrar, descifrar y rotar. */
export const CipherContexts = {
  /** `PlatformOAuthApp.clientSecretCipher`: app OAuth de la plataforma (sin workspace: `platform`). */
  platformOAuthSecret: (provider: string): CipherContext => ({
    purpose: 'platform-oauth-app.client-secret',
    workspaceId: 'platform',
    ids: [provider],
  }),
  /** `Secret.ciphertext`: el nombre es inmutable (la bóveda hace upsert por `workspaceId + name`). */
  secret: (workspaceId: string, name: string): CipherContext => ({
    purpose: 'secret.value',
    workspaceId,
    ids: [name],
  }),
  /** `LlmConnection.apiKeyCipher` (clave estática o access token OAuth vigente). */
  llmApiKey: (workspaceId: string): CipherContext => ({ purpose: 'llm-connection.api-key', workspaceId }),
  /** `LlmConnection.oauthRefreshCipher`. */
  llmRefresh: (workspaceId: string): CipherContext => ({ purpose: 'llm-connection.oauth-refresh', workspaceId }),
  /** `LlmAuthFlow.deviceCodeCipher` mientras el flujo espera la autorización (`status = pending`). */
  llmDeviceCode: (workspaceId: string, flowUserId: string): CipherContext => ({
    purpose: 'llm-auth-flow.device-code',
    workspaceId,
    ids: [flowUserId],
  }),
  /**
   * `LlmAuthFlow.pendingCipher` cuando el flujo espera la confirmación del ADMIN (`status = confirm`, M1b): guarda
   * los tokens ya emitidos y la cuenta autorizada hasta que se confirme o se descarte. Los flujos creados antes de esa
   * columna los tienen en `deviceCodeCipher` con este mismo contexto.
   */
  llmPendingTokens: (workspaceId: string, flowUserId: string): CipherContext => ({
    purpose: 'llm-auth-flow.pending-tokens',
    workspaceId,
    ids: [flowUserId],
  }),
  /** `OAuthCredential.accessTokenCipher` (el conector es inmutable: `connectorId @unique`). */
  oauthAccess: (workspaceId: string, connectorId: string): CipherContext => ({
    purpose: 'oauth-credential.access-token',
    workspaceId,
    ids: [connectorId],
  }),
  /** `OAuthCredential.refreshTokenCipher`. */
  oauthRefresh: (workspaceId: string, connectorId: string): CipherContext => ({
    purpose: 'oauth-credential.refresh-token',
    workspaceId,
    ids: [connectorId],
  }),
  /** `code_verifier` dentro del `state` OAuth firmado: ligado a su `state` (`jti`) y a quien lo inició. */
  oauthStateVerifier: (workspaceId: string, userId: string, jti: string): CipherContext => ({
    purpose: 'oauth-state.code-verifier',
    workspaceId,
    ids: [userId, jti],
  }),
} as const;
