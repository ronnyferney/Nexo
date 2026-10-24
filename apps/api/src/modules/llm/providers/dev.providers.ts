import type { OAuthAppSpec, ProviderCatalogEntry } from './provider-catalog.types';

/** Rutas del simulador (relativas a `PUBLIC_URL`); las sirve `DevLlmSimulatorController`. */
export const DEV_SIM_PATH = '/api/dev/llm-sim';
export const DEV_SIM_PROVIDER_ID = 'nexo-simulado';
export const DEV_SIM_CLIENT_ID = 'nexo-simulador-local';

const DEV_SIM_OAUTH: OAuthAppSpec = {
  idpName: 'el simulador de Nexo',
  authorizeUrl: `${DEV_SIM_PATH}/authorize`,
  tokenUrl: `${DEV_SIM_PATH}/token`,
  deviceUrl: `${DEV_SIM_PATH}/device/code`,
  revokeUrl: `${DEV_SIM_PATH}/revoke`,
  scopes: ['inference'],
  clientAuth: 'post',
  secretRequired: false,
  builtinClientId: DEV_SIM_CLIENT_ID,
};

/**
 * Proveedor de desarrollo: reproduce un proveedor real con inicio de sesión (pantalla de consentimiento, PKCE,
 * refresh token, revocación y código de dispositivo) y una API compatible con OpenAI, para que cualquier desarrollador
 * pruebe en su equipo conectar, renovar, cerrar sesión, volver a iniciarla y usarlo en agentes y flujos.
 */
export const DEV_PROVIDERS: ProviderCatalogEntry[] = [
  {
    id: DEV_SIM_PROVIDER_ID,
    name: 'Proveedor simulado (desarrollo)',
    description: 'Inicio de sesión OAuth y modelos de prueba servidos por su API local. Solo en desarrollo.',
    logo: DEV_SIM_PROVIDER_ID,
    category: 'ROUTER',
    billing: 'FREE_TIER',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: `${DEV_SIM_PATH}/v1`,
    auth: 'OAUTH',
    fields: [],
    docsUrl: 'https://github.com/ronnyferney/Nexo/blob/main/docs/desarrollo-local.md',
    keySteps: [],
    suggestedModels: [
      { id: 'sim-rapido', label: 'Simulado rápido', tier: 'ECONOMY', inputUsdPerMTok: 0, outputUsdPerMTok: 0 },
      { id: 'sim-experto', label: 'Simulado experto', tier: 'PREMIUM', inputUsdPerMTok: 0, outputUsdPerMTok: 0 },
    ],
    notes:
      'Simulador local: el access token dura 2 minutos para ejercitar la renovación automática. En la pantalla de ' +
      'consentimiento puede revocar todas las sesiones para probar «Sesión cerrada».',
    pendingVerification: [],
    authHeader: 'bearer',
    devOnly: true,
    mechanisms: [
      { type: 'OAUTH', label: 'Iniciar sesión (simulado)', primary: true, oauth: DEV_SIM_OAUTH },
      { type: 'DEVICE_CODE', label: 'Conectar con un código (simulado)', primary: false, oauth: DEV_SIM_OAUTH },
    ],
  },
];
