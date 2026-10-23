/**
 * Protocolo JSON entre la API y Nexo Edge sobre WebSocket (`/api/edge/ws`). Documentado en docs/edge-protocol.md.
 * Cada frame de texto es un objeto JSON con `type`. Las respuestas repiten el `id` de la solicitud.
 */

export const EDGE_WS_PATH = '/api/edge/ws';
export const EDGE_TOKEN_PREFIX = 'nexoedge_';
/** Sin señal (mensaje, ping o pong) durante este tiempo, el Edge se considera OFFLINE y se cierra el socket. */
export const EDGE_OFFLINE_AFTER_MS = 45_000;
export const EDGE_HEARTBEAT_MS = 15_000;
export const EDGE_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;

/** Códigos de cierre propios (rango 4000-4999 reservado a aplicaciones). */
export const EDGE_CLOSE = {
  replaced: 4000,
  revoked: 4001,
  invalidMessage: 4002,
  heartbeatTimeout: 4008,
  shutdown: 1001,
} as const;

// ----- Edge -> API -----
export interface HelloMessage {
  type: 'hello';
  version: string;
  hostname: string;
  /** Claves de conexión disponibles (sin credenciales). */
  connections: string[];
}
export interface PingMessage {
  type: 'ping';
}
export interface PongMessage {
  type: 'pong';
}
export type EdgeErrorCode = 'POLICY' | 'DB' | 'CONNECTION' | 'BAD_REQUEST';
export interface ResultMessage {
  type: 'result';
  id: string;
  data: {
    rows: Record<string, unknown>[];
    rowCount: number;
    truncated: boolean;
    fields: { name: string; type?: string }[];
  };
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
  tables: {
    schema: string;
    name: string;
    type: 'TABLE' | 'VIEW';
    columns: { name: string; type: string; nullable: boolean }[];
  }[];
}
export interface TestResultMessage {
  type: 'test_result';
  id: string;
  engine: string;
  version: string;
  durationMs: number;
}
export type EdgeReply = ResultMessage | ErrorMessage | SchemaResultMessage | TestResultMessage;

// ----- API -> Edge -----
export interface WelcomeMessage {
  type: 'welcome';
  edgeId: string;
  name: string;
}
export interface QueryRequest {
  type: 'query';
  id: string;
  connectionKey: string;
  /** Motor esperado por Nexo; el Edge rechaza si no coincide con su conexión local. */
  engine?: string;
  sql: string;
  params: Record<string, unknown>;
  mode: 'read' | 'write';
  maxRows: number;
  timeoutMs: number;
  /** Clave de la operación (solo para auditoría). */
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
/** Solicitud sin `id` (lo asigna EdgeService). */
export type EdgeRequestPayload = Omit<QueryRequest, 'id'> | Omit<SchemaRequest, 'id'> | Omit<TestRequest, 'id'>;

/** Sobre que viaja por Redis `edge:req:<edgeId>`. */
export interface BusRequest {
  requestId: string;
  edgeId: string;
  message: EdgeRequest;
  /** Instante (ms epoch) a partir del cual nadie espera ya la respuesta. */
  deadline: number;
}

export const reqChannel = (edgeId: string) => `edge:req:${edgeId}`;
export const resChannel = (requestId: string) => `edge:res:${requestId}`;
export const CONTROL_CHANNEL = 'edge:control';

export interface ControlMessage {
  type: 'kick';
  edgeId: string;
  /** Conexión que debe sobrevivir (la nueva); ausente = cerrar todas (token revocado o Edge eliminado). */
  keepConnId?: string;
  reason: 'replaced' | 'revoked';
}
