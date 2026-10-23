import type { Agent } from '@prisma/client';

/** Permiso efectivo de un usuario sobre un agente (ADR 0007). */
export type AgentPermission = 'OWNER' | 'EDIT' | 'USE' | 'ADMIN_VIEW';
export type AgentNeed = 'USE' | 'EDIT';
export type AgentScope = 'mine' | 'shared' | 'workspace' | 'all';

export interface AgentAccess {
  agent: Agent;
  permission: AgentPermission;
}

export type HealthCategory = 'PROFILE' | 'TOOLS' | 'KNOWLEDGE' | 'QUALITY' | 'COST' | 'OPERATIONS';
export type HealthLevel = 'CRITICAL' | 'NEEDS_WORK' | 'GOOD' | 'EXCELLENT';

export interface HealthCheck {
  id: string;
  category: HealthCategory;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  passed: boolean;
  message: string;
  recommendation: string;
  action?: { type: 'OPEN_TAB' | 'COPILOT'; tab?: string; prompt?: string };
}

/** Puntaje de salud determinista del agente (ADR 0006 D3). */
export interface AgentHealth {
  agentId: string;
  score: number;
  level: HealthLevel;
  checks: HealthCheck[];
  evaluatedAt: string;
}
