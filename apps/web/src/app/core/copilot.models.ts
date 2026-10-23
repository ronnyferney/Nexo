/** Contratos de Nexo Copilot (ADR 0006). */

export type CopilotMode = 'CREATE' | 'IMPROVE' | 'DIAGNOSE';
export type CopilotProposalKind = 'CREATE_AGENT' | 'UPDATE_AGENT';
export type CopilotProposalStatus = 'PENDING' | 'APPLIED' | 'DISCARDED';
export type CopilotRating = 'UP' | 'DOWN';

/** `POST /copilot/sessions`. */
export interface CopilotSessionInput {
  mode: CopilotMode;
  agentId?: string;
  context?: string;
}

export interface CopilotSessionRef {
  id: string;
  mode: CopilotMode;
  agentId: string | null;
}

/** `GET /copilot/sessions/:id`. `id` de cada mensaje es opcional (no está en el contrato; se usa para calificar). */
export interface CopilotSession extends CopilotSessionRef {
  messages: { id?: string; role: 'user' | 'assistant'; text: string }[];
  proposals: CopilotProposal[];
}

export interface CopilotProposal {
  id: string;
  kind: CopilotProposalKind;
  status: CopilotProposalStatus;
  summary: string;
  /** Agente propuesto o cambios propuestos; la forma exacta la define el backend (ADR 0006 D1). */
  payload: Record<string, unknown>;
  agentId: string | null;
  createdAt: string;
}

/** `POST /copilot/proposals/:id/apply`. */
export interface CopilotApplyResult {
  agentId: string;
  created: { skills: number; examples: number; evalCases: number; routines: number };
  pendingIntegrations: string[];
}

/** `GET /copilot/quota`. */
export interface CopilotQuota {
  limitUsd: number;
  usedUsd: number;
  remainingUsd: number;
  period: string;
}

/** `POST /copilot/messages/:messageId/feedback`. */
export interface CopilotFeedbackInput {
  rating: CopilotRating;
  comment?: string;
  shareConversation?: boolean;
}

/**
 * Eventos SSE de `POST /copilot/sessions/:id/messages` (mismos que el chat de agentes más `proposal`).
 * `messageId` en `done` es una suposición: identifica la respuesta del Copilot para calificarla.
 */
export type CopilotStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; output: string; isError: boolean }
  | { type: 'notice'; message: string }
  | { type: 'proposal'; id: string; kind: CopilotProposalKind; summary: string }
  | { type: 'done'; messageId?: string; text?: string; conversationId?: string }
  | { type: 'error'; message: string; code?: string };

/** Nombres legibles de las herramientas internas del Copilot. */
export const COPILOT_TOOL_LABELS: Record<string, string> = {
  get_agent: 'Revisó la configuración del agente',
  get_agent_health: 'Consultó la salud del agente',
  list_connectors: 'Revisó los conectores',
  list_catalog: 'Revisó el catálogo de integraciones',
  list_skills: 'Revisó las skills',
  list_knowledge_bases: 'Revisó las bases de conocimiento',
  get_recent_failures: 'Analizó fallos recientes',
  propose_agent: 'Preparó una propuesta de agente',
  propose_changes: 'Preparó una propuesta de cambios',
};

export const COPILOT_MODE_LABELS: Record<CopilotMode, string> = {
  CREATE: 'Crear',
  IMPROVE: 'Mejorar',
  DIAGNOSE: 'Diagnosticar',
};
