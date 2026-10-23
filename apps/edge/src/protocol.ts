/**
 * Protocolo JSON Nexo ↔ Edge (copia del lado Edge de apps/api/src/modules/edge/edge.protocol.ts).
 * Referencia completa: docs/edge-protocol.md.
 */
import type { DbQueryResult, SchemaTable } from './core/drivers';

export const EDGE_WS_PATH = '/api/edge/ws';
export const EDGE_TOKEN_PREFIX = 'nexoedge_';

export const EDGE_CLOSE = {
  replaced: 4000,
  revoked: 4001,
  invalidMessage: 4002,
  heartbeatTimeout: 4008,
} as const;

export type EdgeErrorCode = 'POLICY' | 'DB' | 'CONNECTION' | 'BAD_REQUEST';

// ----- Nexo -> Edge -----
export interface WelcomeMessage {
  type: 'welcome';
  edgeId: string;
  name: string;
}
export interface QueryRequest {
  type: 'query';
  id: string;
  connectionKey: string;
  engine?: string;
  sql: string;
  params: Record<string, unknown>;
  mode: 'read' | 'write';
  maxRows?: number;
  timeoutMs?: number;
  operation?: string;
}
export interface SchemaRequest {
  type: 'schema';
  id: string;
  connectionKey: string;
  tables?: string[];
  search?: string;
}
export interface TestRequest {
  type: 'test';
  id: string;
  connectionKey: string;
}
export type EdgeRequest = QueryRequest | SchemaRequest | TestRequest;

// ----- Edge -> Nexo -----
export interface HelloMessage {
  type: 'hello';
  version: string;
  hostname: string;
  connections: string[];
}
export interface ResultMessage {
  type: 'result';
  id: string;
  data: DbQueryResult;
  durationMs: number;
}
export interface ErrorMessage {
  type: 'error';
  id: string;
  code: EdgeErrorCode;
  message: string;
}
export interface SchemaResultMessage {
  type: 'schema_result';
  id: string;
  engine: string;
  tables: SchemaTable[];
}
export interface TestResultMessage {
  type: 'test_result';
  id: string;
  engine: string;
  version: string;
  durationMs: number;
}
export type EdgeReply = ResultMessage | ErrorMessage | SchemaResultMessage | TestResultMessage;
