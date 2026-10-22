import type { ConnectorType } from '@prisma/client';

/** Autenticación declarativa. Los valores admiten plantillas: "{{ secrets.CRM_TOKEN }}". */
export type ConnectorAuth =
  | { type: 'none' }
  | { type: 'apiKey'; in: 'header' | 'query'; name: string; value: string }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'oauth2'; tokenUrl: string; clientId: string; clientSecret: string; scope?: string };

export interface RestConfig {
  baseUrl: string;
  headers?: Record<string, string>;
  openApiUrl?: string;
  timeoutMs?: number;
}

export interface RestOperationDef {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: unknown;
  bodyType?: 'json' | 'form' | 'text';
}

export interface SoapConfig {
  endpoint: string;
  wsdlUrl?: string;
  soapVersion?: '1.1' | '1.2';
  headers?: Record<string, string>;
  /** Fragmento XML opcional para <soap:Header> (WS-Security, etc). */
  headerTemplate?: string;
}

export interface SoapOperationDef {
  action: string;
  /** Contenido de <soap:Body>, con plantillas {{ input.x }} (se escapan automáticamente). */
  bodyTemplate: string;
}

export interface GraphqlConfig {
  endpoint: string;
  headers?: Record<string, string>;
}

export interface GraphqlOperationDef {
  query: string;
  variables?: Record<string, unknown>;
}

export interface McpConfig {
  transport: 'streamable-http' | 'sse';
  url: string;
  headers?: Record<string, string>;
}

export interface McpOperationDef {
  toolName: string;
}

export interface ConnectorRuntime {
  id: string;
  workspaceId: string;
  type: ConnectorType;
  config: Record<string, unknown>;
  auth: ConnectorAuth;
  secrets: Record<string, string>;
}

export interface OperationRuntime {
  key: string;
  definition: Record<string, unknown>;
}

export interface InvocationResult {
  ok: boolean;
  status?: number;
  data: unknown;
  durationMs: number;
  meta?: Record<string, unknown>;
}

export interface DiscoveredOperation {
  key: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  definition: Record<string, unknown>;
}

export interface TestResult {
  ok: boolean;
  message: string;
  details?: unknown;
}
