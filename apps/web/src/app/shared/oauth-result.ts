/**
 * Motivos de error del callback OAuth2 que la API envía en `?oauth=error&reason=<code>`
 * (`apps/api/src/modules/oauth/oauth.service.ts`, tipo `OAuthErrorReason`).
 */
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_state:
    'La solicitud de conexión expiró o ya fue usada. Abra el conector y pulse «Conectar cuenta» de nuevo.',
  access_denied: 'Se canceló o rechazó el consentimiento en el proveedor. Vuelva a intentarlo y acepte los permisos solicitados.',
  missing_code: 'El proveedor no devolvió un código de autorización. Intente conectar la cuenta de nuevo.',
  forbidden: 'Su rol ya no permite conectar cuentas en este espacio de trabajo. Se requiere rol Editor o superior.',
  not_found: 'El conector ya no existe o cambió su tipo de autenticación.',
  not_configured:
    'La app OAuth de este proveedor no está configurada en la plataforma; use una app propia en Autenticación o pida al administrador que la configure.',
  exchange_failed:
    'El proveedor rechazó el intercambio del código por el token. Revise el Client ID, el secreto y la URL de redirección de la app OAuth, y vuelva a intentarlo.',
};

/** Texto en español, accionable, para el motivo recibido en la URL. */
export function oauthErrorMessage(reason: string | null | undefined): string {
  const detail = (reason && OAUTH_ERROR_MESSAGES[reason]) || 'Intente de nuevo.';
  return `No se pudo conectar la cuenta. ${detail}`;
}

/** Parámetros de consulta del retorno OAuth a limpiar de la URL (incluye `message`, heredado). */
export const OAUTH_QUERY_CLEAR = { oauth: null, reason: null, message: null } as const;
