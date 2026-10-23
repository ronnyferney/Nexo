import type { ConnectorType } from '@prisma/client';
import type { ConnectorAuth } from '../domain/connector.types';

export type CatalogCategory = 'CRM' | 'PROSPECCION' | 'PRODUCTIVIDAD' | 'MENSAJERIA' | 'DATOS';
export type CatalogAuthMethod = 'apiKey' | 'bearer' | 'oauth2_code' | 'mcp';

/** Campo de credencial: se guarda en la bóveda como `<SLUG>_<CAMPO>` (nunca en el conector). */
export interface CatalogCredentialField {
  /** camelCase; el secreto se llama `<SLUG>_<KEY_EN_MAYUSCULAS>` (ver `secretName`). */
  key: string;
  label: string;
  /** false = dato no sensible (ID de número, subdominio...), igualmente se guarda en la bóveda. */
  secret: boolean;
  required: boolean;
  help?: string;
  /** Métodos de autenticación a los que aplica; ausente = todos. */
  authMethods?: CatalogAuthMethod[];
  /** Valor por defecto si no se envía (solo campos no sensibles). */
  default?: string;
  /** Expresión regular que debe cumplir el valor (evita, p. ej., subdominios con rutas). */
  pattern?: string;
}

/** Operación prediseñada: se crea como `ConnectorOperation` y se expone como tool para agentes. */
export interface CatalogOperation {
  key: string;
  name: string;
  /** Español, orientada a que un agente decida cuándo usarla. Las de escritura incluyen el aviso de efecto. */
  description: string;
  /** true = crea/modifica datos en el sistema remoto. */
  write: boolean;
  inputSchema: Record<string, unknown>;
  /** Definición del adaptador (REST: method, path, query, headers, body, bodyType). */
  definition: Record<string, unknown>;
  /** false si no se pudo verificar contra la documentación oficial (ver `verificationNotes`). */
  verified: boolean;
  docsUrl: string;
}

export interface CatalogEntry {
  id: string;
  /** Prefijo de secretos en MAYÚSCULAS (p. ej. HUBSPOT → HUBSPOT_ACCESS_TOKEN). */
  slug: string;
  name: string;
  category: CatalogCategory;
  description: string;
  /** Nombre de ícono del design system de la web. */
  icon: string;
  docsUrl: string;
  connectorType: ConnectorType;
  /** Plantilla de configuración del conector (admite `{{ secrets.X }}`). */
  config: Record<string, unknown>;
  /** Autenticación por método (plantillas con `{{ secrets.X }}`). El primero es el predeterminado. */
  auth: Partial<Record<CatalogAuthMethod, ConnectorAuth>>;
  credentialFields: CatalogCredentialField[];
  operations: CatalogOperation[];
  /** Descubrir operaciones (tools MCP) al instalar. */
  discoverOnInstall?: boolean;
  /** true solo si endpoints, métodos, auth y parámetros se verificaron contra la documentación oficial. */
  verified: boolean;
  verificationNotes?: string;
}

/** `<SLUG>_<CAMPO>`: accessToken → HUBSPOT_ACCESS_TOKEN. */
export function secretName(slug: string, key: string): string {
  return `${slug}_${key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`;
}

/** Plantilla de referencia a un secreto del catálogo. */
export function secretRef(slug: string, key: string): string {
  return `{{ secrets.${secretName(slug, key)} }}`;
}

/** Aviso obligatorio en la descripción de las operaciones de escritura. */
export const WRITE_NOTICE = '(acción con efecto: crea/modifica datos)';

/** Patrones reutilizables para entradas que se interpolan en rutas o cabeceras. */
export const PATTERNS = {
  /** Sin saltos de línea (evita inyección de cabeceras en correos). */
  singleLine: String.raw`^[^\r\n]*$`,
  /** Identificador seguro para un segmento de ruta. */
  pathId: String.raw`^[A-Za-z0-9_.:-]{1,200}$`,
  numericId: String.raw`^[0-9]{1,30}$`,
  /** Texto para literales SOQL: sin comillas, barras invertidas ni saltos de línea. */
  soqlText: String.raw`^[^'"\\\r\n]{0,100}$`,
  /**
   * Id de Microsoft Graph para un segmento de ruta: admite `=`, `-`, `_` (ids de Outlook/To Do en base64 URL-safe)
   * y `:`/`@` (canales y chats de Teams, `19:...@thread.tacv2`). Sin `/`, `?`, `#`, `%`, espacios ni `..`, y nunca
   * compuesto solo de puntos (`.`/`..` alterarían la ruta al normalizar la URL).
   */
  graphId: String.raw`^(?!\.+$)(?!.*\.\.)[A-Za-z0-9_.:=@-]{1,512}$`,
  /** ETag de Microsoft Graph para `If-Match` (Planner): `W/"..."`, sin saltos de línea. */
  graphEtag: String.raw`^(W/)?"[A-Za-z0-9+/=_-]{1,500}"$`,
  /** Zona horaria (IANA o Windows) para `Prefer: outlook.timezone="..."`: sin comillas ni saltos de línea. */
  timeZone: String.raw`^[A-Za-z0-9_+/ ().,:-]{1,100}$`,
  /** GUID (id de objeto de usuario de Entra ID). */
  guid: String.raw`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`,
} as const;
