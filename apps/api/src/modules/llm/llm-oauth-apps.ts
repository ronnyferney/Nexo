import type { ConfigService } from '@nestjs/config';
import { render } from '../../common/template/template.engine';
import type { OAuthEndpointOverride } from '../../config/configuration';
import {
  entryMechanisms,
  type MechanismType,
  type OAuthAppSpec,
  type ProviderCatalogEntry,
  type ProviderMechanismSpec,
} from './providers';

/** Mecanismo de conexión tal como lo ve la web (`ProviderView.mechanisms`). */
export interface MechanismView {
  type: MechanismType;
  label: string;
  available: boolean;
  unavailableReason?: string;
  primary: boolean;
  /** Pasos para el cliente en los mecanismos sin claves (registrar el emisor de Nexo, crear el rol de IAM). */
  steps?: string[];
}

/** Motivos de no disponibilidad de los mecanismos sin claves en esta instalación (`null` = disponible). */
export type KeylessAvailability = Partial<Record<'WORKLOAD_IDENTITY' | 'AWS_ROLE', string | null>>;

/** App OAuth de Nexo lista para usar: credenciales del entorno y endpoints ya renderizados. */
export interface ResolvedLlmOAuthApp {
  providerId: string;
  idpName: string;
  clientId: string;
  clientSecret?: string;
  authorizeUrl: string;
  tokenUrl: string;
  deviceUrl?: string;
  revokeUrl?: string;
  scopes: string[];
  authorizeParams: Record<string, string>;
  scopeOnTokenRequest: boolean;
  clientAuth: 'post' | 'basic';
}

export class LlmOAuthAppError extends Error {}

/**
 * Variables de la app OAuth de Nexo para un proveedor del catálogo: `OAUTH_LLM_<PROVEEDOR>_CLIENT_ID/SECRET`
 * (p. ej. `OAUTH_LLM_AZURE_OPENAI_CLIENT_ID`). Son credenciales **de Nexo**, nunca de otro producto.
 */
export function llmOAuthEnvName(providerId: string, kind: 'CLIENT_ID' | 'CLIENT_SECRET'): string {
  return `OAUTH_LLM_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_${kind}`;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Motivo por el que la app de Nexo no está configurada (o null si lo está). */
export function oauthAppUnavailableReason(
  config: ConfigService,
  entry: ProviderCatalogEntry,
  spec: OAuthAppSpec,
): string | null {
  const idVar = llmOAuthEnvName(spec.appKey ?? entry.id, 'CLIENT_ID');
  const secretVar = llmOAuthEnvName(spec.appKey ?? entry.id, 'CLIENT_SECRET');
  const hasId = !!str(config.get<string>(idVar)) || !!spec.builtinClientId;
  const hasSecret = !!str(config.get<string>(secretVar));
  if (hasId && (hasSecret || !spec.secretRequired)) return null;
  const missing = spec.secretRequired ? `${idVar} y ${secretVar}` : idVar;
  return (
    `La app de Nexo para iniciar sesión con ${spec.idpName} no está configurada en esta instalación ` +
    `(el administrador de la plataforma debe definir ${missing}).`
  );
}

/**
 * Credenciales y endpoints de la app OAuth de Nexo para un proveedor. Las URLs se renderizan con los campos no secretos
 * del formulario (p. ej. `tenantId`) y admiten `LLM_OAUTH_ENDPOINT_OVERRIDES`. Lanza `LlmOAuthAppError` si falta la
 * configuración.
 */
export function resolveLlmOAuthApp(
  config: ConfigService,
  entry: ProviderCatalogEntry,
  spec: OAuthAppSpec,
  values: Record<string, string>,
): ResolvedLlmOAuthApp {
  const reason = oauthAppUnavailableReason(config, entry, spec);
  if (reason) throw new LlmOAuthAppError(reason);
  const overrides = config.get<Record<string, OAuthEndpointOverride>>('llm.oauthEndpointOverrides');
  const override = overrides?.[entry.id] ?? (spec.appKey ? overrides?.[spec.appKey] : undefined) ?? {};
  const publicUrl = (config.get<string>('publicUrl') ?? 'http://localhost:3000').replace(/\/+$/, '');
  const url = (template: string | undefined) => {
    if (!template) return undefined;
    const rendered = String(render<unknown>(template, values) ?? '').replace(/\/+$/, '');
    // Rutas relativas (simulador local): se sirven bajo PUBLIC_URL.
    return rendered.startsWith('/') ? `${publicUrl}${rendered}` : rendered;
  };
  const secret = str(config.get<string>(llmOAuthEnvName(spec.appKey ?? entry.id, 'CLIENT_SECRET')));
  return {
    providerId: entry.id,
    idpName: spec.idpName,
    clientId:
      str(config.get<string>(llmOAuthEnvName(spec.appKey ?? entry.id, 'CLIENT_ID'))) || spec.builtinClientId || '',
    ...(secret ? { clientSecret: secret } : {}),
    authorizeUrl: url(override.authorizeUrl ?? spec.authorizeUrl)!,
    tokenUrl: url(override.tokenUrl ?? spec.tokenUrl)!,
    deviceUrl: url(override.deviceUrl ?? spec.deviceUrl),
    revokeUrl: url(override.revokeUrl ?? spec.revokeUrl),
    scopes: spec.scopes,
    authorizeParams: spec.authorizeParams ?? {},
    scopeOnTokenRequest: !!spec.scopeOnTokenRequest,
    clientAuth: spec.clientAuth,
  };
}

const LOCAL_SSRF_REASON =
  'La protección SSRF de Nexo bloquea redes privadas: la detección local requiere Nexo Edge o una instalación ' +
  'on-premise con CONNECTOR_ALLOW_PRIVATE_NETWORKS=true. Puede ingresar una URL pública alcanzable.';

/**
 * Disponibilidad de cada mecanismo de una entrada para la configuración actual. Los mecanismos sin claves dependen del
 * emisor OIDC y del principal de AWS de la plataforma (`keyless`); sin ese dato se consideran no disponibles.
 */
export function mechanismViews(
  config: ConfigService,
  entry: ProviderCatalogEntry,
  keyless: KeylessAvailability = {},
): MechanismView[] {
  return entryMechanisms(entry).map((m: ProviderMechanismSpec): MechanismView => {
    let reason: string | null = null;
    if (m.type === 'WORKLOAD_IDENTITY' || m.type === 'AWS_ROLE') {
      reason = keyless[m.type] === undefined ? 'No disponible en esta instalación.' : keyless[m.type]!;
    }
    if ((m.type === 'OAUTH' || m.type === 'DEVICE_CODE') && m.oauth) {
      reason = oauthAppUnavailableReason(config, entry, m.oauth);
      if (!reason && m.type === 'DEVICE_CODE' && !m.oauth.deviceUrl) {
        reason = `${m.oauth.idpName} no documenta el flujo de código de dispositivo.`;
      }
    }
    if (m.type === 'LOCAL_DETECT' && !config.get<boolean>('http.allowPrivateNetworks')) reason = LOCAL_SSRF_REASON;
    return {
      type: m.type,
      label: m.label,
      available: !reason,
      ...(reason ? { unavailableReason: reason } : {}),
      primary: m.primary,
      ...(m.steps?.length ? { steps: m.steps } : {}),
    };
  });
}
