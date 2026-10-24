import type { HealthLevel } from './access.models';

/** `GET /platform/me` (ADR 0006 D6): rol de plataforma definido por `PLATFORM_ADMIN_EMAILS`. */
export interface PlatformMe {
  isPlatformAdmin: boolean;
}

export interface AtRiskWorkspace {
  id: string;
  name: string;
  reason: string;
}

/** `GET /platform/copilot/metrics?from&to` — métricas de éxito de clientes. */
export interface CopilotMetrics {
  workspaces: number;
  activeWorkspaces: number;
  agentsCreated: number;
  agentsLaunched: number;
  medianMinutesToFirstLaunch: number | null;
  healthDistribution: Partial<Record<HealthLevel, number>>;
  avgEvalScore: number | null;
  copilotSatisfaction: { up: number; down: number };
  quotaUsageUsd: number;
  atRiskWorkspaces: AtRiskWorkspace[];
}

/** Mensaje de una conversación del Copilot compartida explícitamente por el usuario. */
export interface SharedCopilotMessage {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Elemento de `GET /platform/copilot/feedback`. El ADR solo fija "calificaciones y comentarios; conversación solo si el
 * usuario la compartió": los campos de contexto (workspace, texto calificado) son opcionales.
 */
export interface CopilotFeedbackItem {
  id: string;
  rating: 'UP' | 'DOWN';
  comment?: string | null;
  createdAt: string;
  workspaceId?: string;
  workspaceName?: string | null;
  workspace?: { id: string; name: string } | null;
  /** Texto de la respuesta del Copilot calificada. */
  messageText?: string | null;
  copilotVersion?: string | null;
  sharedConversation?: SharedCopilotMessage[] | null;
}

/** Proveedor OAuth de la plataforma en la consola (`GET /platform/oauth-apps`). */
export interface PlatformOAuthProvider {
  provider: string;
  label: string;
  configured: boolean;
  source: 'console' | 'env' | null;
  clientIdHint: string | null;
  redirectUri: string;
  scopes: string[];
  integrations: string[];
}

