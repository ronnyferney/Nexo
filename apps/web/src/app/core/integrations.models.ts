import type { Connector, ConnectorType } from './models';

// ===== Catálogo de conectores nativos (ADR 0005 D2) =====

export type CatalogCategory = 'CRM' | 'PROSPECCION' | 'PRODUCTIVIDAD' | 'MENSAJERIA' | 'DATOS';
export type CatalogAuthMethod = 'apiKey' | 'bearer' | 'oauth2_code' | 'mcp';

export interface CatalogCredentialField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  help?: string;
  /** Opcional: métodos de autenticación a los que aplica el campo; ausente = todos. */
  authMethods?: CatalogAuthMethod[];
  /** Opcional: valor por defecto (solo campos no sensibles). */
  default?: string;
  /** Opcional: expresión regular que debe cumplir el valor. */
  pattern?: string;
}

export interface CatalogOperation {
  key: string;
  name: string;
  description: string;
  /** true = crea o modifica datos en el sistema remoto. */
  write?: boolean;
}

/** Entrada de `GET /connector-catalog`. */
export interface CatalogEntry {
  id: string;
  name: string;
  category: CatalogCategory;
  description: string;
  /** Nombre de ícono del mapa de `nx-icon` o URL de un logo. */
  icon: string;
  docsUrl: string;
  connectorType: ConnectorType;
  authMethods: CatalogAuthMethod[];
  credentialFields: CatalogCredentialField[];
  operations: CatalogOperation[];
  /** Conectores ya instalados desde esta definición en el workspace. */
  installed: number;
  /** De ellos, los de OAuth cuyo inicio de sesión no terminó (no conectados todavía). */
  pendingAuth: number;
  /** App OAuth de la plataforma para «Iniciar sesión con…» (solo integraciones OAuth). */
  platformApp?: { available: boolean; clientIdHint: string | null };
}

/** Cuenta instalada de una integración (`GET /connector-catalog/:id/accounts`). */
export interface CatalogAccount {
  connectorId: string;
  name: string;
  oauth: boolean;
  connected: boolean;
  accountLabel: string | null;
  /** App OAuth que usará «Conectar»: de la plataforma o propia (guardada en la bóveda), con su client ID abreviado. */
  app?: { kind: 'platform' | 'own' | null; clientIdHint: string | null; problem: string | null };
}

/** Qué usa un conector (`GET /connectors/:id/usage`): lo que deja de funcionar al desconectarlo. */
export interface ConnectorUsage {
  agents: { id: string; name: string }[];
  workflows: { id: string; name: string; active: boolean }[];
}

/** Cuerpo de `POST /connector-catalog/:id/install`. */
export interface CatalogInstallInput {
  name?: string;
  authMethod: CatalogAuthMethod;
  credentials: Record<string, string>;
}

/** Respuesta de la instalación: el conector creado y, para `oauth2_code`, la URL de consentimiento. */
export type CatalogInstallResult = Connector & { authorizeUrl?: string };

/** Respuesta de `POST /connector-catalog/starter-kit/commercial` (forma tolerante: el contrato no la detalla). */
export interface StarterKitResult {
  skills?: { id: string; name: string }[];
  created?: number;
}

// ===== OAuth2 de usuario (ADR 0005 D3) =====

/** `GET /connectors/:id/oauth`. */
export interface OAuthStatus {
  connected: boolean;
  accountLabel: string | null;
  scope: string | null;
  expiresAt: string | null;
  /** App OAuth que usa el inicio de sesión: de la plataforma o propia, con su client ID abreviado (o el problema). */
  app?: { kind: 'platform' | 'own' | null; clientIdHint: string | null; problem: string | null };
}

// ===== Conector de base de datos (ADR 0005 D4) =====

export type DatabaseEngine = 'postgres' | 'mysql' | 'mssql';
export type DatabaseMode = 'direct' | 'edge';

/** `config` de un conector `DATABASE`. */
export interface DatabaseConfig {
  engine: DatabaseEngine;
  mode: DatabaseMode;
  edgeId?: string;
  connectionKey?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  /** Siempre una referencia a la bóveda: `{{ secrets.X }}`. */
  password?: string;
  ssl?: boolean;
  allowWrites?: boolean;
}

/** `definition` de una operación SQL declarada. */
export interface SqlOperationDefinition {
  sql: string;
  mode: 'read' | 'write';
  maxRows?: number;
  timeoutMs?: number;
}

export interface DbColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface DbTable {
  schema: string;
  name: string;
  type: 'TABLE' | 'VIEW';
  columns: DbColumn[];
}

/** `GET /connectors/:id/schema`. */
export interface DbSchema {
  tables: DbTable[];
}

/** `POST /connectors/:id/discover`. */
export interface DiscoverResult {
  imported: number;
  operations: string[];
}

/** Resultado (`data`) de invocar una operación SQL. `fields` puede llegar como nombres o como objetos. */
export interface SqlQueryResult {
  rows: Record<string, unknown>[];
  fields?: (string | { name: string; type?: string })[];
  rowCount?: number;
  truncated?: boolean;
}

// ===== Nexo Edge (ADR 0005 D5) =====

export type EdgeStatus = 'ONLINE' | 'OFFLINE';

/** `GET /admin/edges`. */
export interface EdgeAgent {
  id: string;
  name: string;
  status: EdgeStatus;
  lastSeenAt: string | null;
  version: string | null;
  hostname: string | null;
  connections: string[];
}

/** `GET /edges` (cualquier rol, para selectores). */
export interface EdgeOption {
  id: string;
  name: string;
  status: EdgeStatus;
  connections: string[];
}

/** `POST /admin/edges` — el token solo se devuelve una vez. */
export interface EdgeCreated {
  id: string;
  name: string;
  token: string;
}
