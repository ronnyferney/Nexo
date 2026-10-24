import { API_KEY_FIELD, type ProviderCatalogEntry } from './provider-catalog.types';

/**
 * Enrutadores. Fuente verificada el 2026-10-23: SDK `@openrouter/sdk` 1.5.6 (servidor `https://openrouter.ai/api/v1`;
 * OAuth PKCE: `oAuthCreateAuthorizationUrl` → `https://openrouter.ai/auth?callback_url&code_challenge&
 * code_challenge_method`, `exchangeAuthCodeForAPIKey` → `POST /auth/keys` `{ code, code_verifier,
 * code_challenge_method }` → `{ key, user_id }`; `GET /key` = metadatos de la clave actual; cabeceras de atribución
 * `HTTP-Referer` y `X-OpenRouter-Title`).
 */
export const ROUTER_PROVIDERS: ProviderCatalogEntry[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Acceso a cientos de modelos de terceros con una sola cuenta de OpenRouter.',
    logo: 'openrouter',
    category: 'ROUTER',
    billing: 'PAY_AS_YOU_GO',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: 'https://openrouter.ai/api/v1',
    auth: 'OAUTH',
    fields: [
      API_KEY_FIELD({
        help: 'Opcional si conecta con «Iniciar sesión con OpenRouter» (OAuth PKCE).',
        mechanisms: ['API_KEY'],
      }),
    ],
    docsUrl: 'https://openrouter.ai/docs/use-cases/oauth-pkce',
    keySteps: [],
    suggestedModels: [],
    notes:
      'Con OAuth, OpenRouter crea una clave para Nexo con el límite de crédito que usted elija. Elija los modelos con «Descubrir».',
    pendingVerification: ['precios', 'restricciones de callback_url', 'conservación de parámetros de callback_url'],
    authHeader: 'bearer',
    // `/key` devuelve los metadatos de la clave actual (`apiKeysGetCurrentKeyMetadata`): valida la clave en sí.
    verifyPath: '/key',
    headers: { 'X-OpenRouter-Title': 'Nexo' },
    // El PKCE de OpenRouter no exige registrar la app: siempre disponible.
    mechanisms: [
      { type: 'OAUTH', label: 'Iniciar sesión con OpenRouter', primary: true },
      { type: 'API_KEY', label: 'Clave de API', primary: false },
    ],
  },
];
