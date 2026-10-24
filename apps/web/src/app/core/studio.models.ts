// ===== Estudio de agentes (ADR 0003): perfil, skills, conocimiento, ejemplos y rutinas =====

/** Perfil estructurado del agente (D2). Todos los campos son opcionales en la API; aquí se normalizan a vacíos. */
export interface AgentProfile {
  role: string;
  goals: string[];
  responsibilities: string[];
  boundaries: string[];
  tone: string;
  outputFormat: string;
  language: string;
}

export const EMPTY_PROFILE: AgentProfile = {
  role: '',
  goals: [],
  responsibilities: [],
  boundaries: [],
  tone: '',
  outputFormat: '',
  language: '',
};

/** Normaliza un perfil parcial (o nulo) recibido de la API. */
export function normalizeProfile(p: Partial<AgentProfile> | null | undefined): AgentProfile {
  return {
    role: p?.role ?? '',
    goals: [...(p?.goals ?? [])],
    responsibilities: [...(p?.responsibilities ?? [])],
    boundaries: [...(p?.boundaries ?? [])],
    tone: p?.tone ?? '',
    outputFormat: p?.outputFormat ?? '',
    language: p?.language ?? '',
  };
}

/** Referencias resumidas que `GET /agents/:id` incluye. */
export interface AgentSkillRef {
  id: string;
  name: string;
  slug: string;
}

export interface AgentKnowledgeRef {
  id: string;
  name: string;
}

/** Base de conocimiento asignada a un agente, con el permiso de escritura (auto-aprendizaje). */
export interface AgentKnowledgeEntry {
  knowledgeBaseId: string;
  canWrite: boolean;
  knowledgeBase: { id: string; name: string; description: string | null };
}

/** `GET /agents/:id/prompt-preview`. */
export interface PromptPreview {
  system: string;
  tools: { name: string; description: string }[];
}

/** `GET /agents/:id/examples` (máx. 20 por agente). */
export interface AgentExample {
  id: string;
  input: string;
  output: string;
  createdAt: string;
}

export interface AgentExampleInput {
  input: string;
  output: string;
}

// ----- Skills (D3) -----

export interface Skill {
  id: string;
  name: string;
  slug: string;
  description: string;
  instructions: string;
  operationIds: string[];
  agentCount: number;
  updatedAt: string;
}

export interface SkillInput {
  name: string;
  description: string;
  instructions: string;
  operationIds?: string[];
}

// ----- Conocimiento (D4) -----

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  documentCount: number;
  chunkCount: number;
  agentCount: number;
  updatedAt: string;
}

export interface KnowledgeBaseInput {
  name: string;
  description?: string;
}

export type KnowledgeSourceType = 'TEXT' | 'URL' | 'FILE';
export type KnowledgeDocumentStatus = 'READY' | 'FAILED';

export interface KnowledgeDocument {
  id: string;
  title: string;
  sourceType: KnowledgeSourceType;
  source: string | null;
  status: KnowledgeDocumentStatus;
  error: string | null;
  chunkCount: number;
  charCount: number;
  createdAt: string;
}

export type KnowledgeDocumentInput = { title: string; text: string } | { title?: string; url: string };

export interface KnowledgeSearchHit {
  documentId: string;
  title: string;
  content: string;
  score: number;
}

/** Extensiones y tamaño admitidos por `POST /knowledge-bases/:id/documents/upload`. */
export const KNOWLEDGE_FILE_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.html'] as const;
export const KNOWLEDGE_FILE_MAX_BYTES = 5 * 1024 * 1024;

// ----- Rutinas (D5) -----

export interface Routine {
  id: string;
  agentId: string;
  agentName: string;
  name: string;
  prompt: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  notifyWebhookUrl: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  nextRunAt: string | null;
}

export interface RoutineInput {
  name: string;
  prompt: string;
  schedule: string;
  timezone?: string;
  enabled?: boolean;
  /** `null` elimina el webhook en `PATCH`. */
  notifyWebhookUrl?: string | null;
}

export type RoutineRunStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export interface RoutineRun {
  id: string;
  status: RoutineRunStatus;
  output: string | null;
  error: string | null;
  costUsd: number;
  startedAt: string;
  finishedAt: string | null;
}
