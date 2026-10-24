import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Api } from './app';

export const PASSWORD = 'Clave-Segura-123';

let seq = 0;
/** Correo único por ejecución: la suite no trunca tablas, aísla por datos. */
export function uniqueEmail(tag = 'user'): string {
  seq += 1;
  return `e2e-${tag}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}-${seq}@nexo.test`.toLowerCase();
}

export interface Session {
  api: Api;
  token: string;
  workspaceId: string;
  userId: string;
  email: string;
  role: string;
  membershipId?: string;
}

async function me(app: INestApplication, token: string): Promise<string> {
  const res = await new Api(app, token).get('/auth/me').expect(200);
  return (res.body as { id: string }).id;
}

/** Registra un usuario nuevo: crea su workspace (con unidad raíz) y lo deja como OWNER. */
export async function registerOwner(app: INestApplication, tag = 'owner'): Promise<Session> {
  const email = uniqueEmail(tag);
  const res = await new Api(app)
    .post('/auth/register', { email, name: `Dueño ${tag}`, password: PASSWORD, workspaceName: `WS ${tag} ${seq}` })
    .expect(201);
  const body = res.body as { accessToken: string; workspaceId: string; role: string };
  const userId = await me(app, body.accessToken);
  return {
    api: new Api(app, body.accessToken),
    token: body.accessToken,
    workspaceId: body.workspaceId,
    userId,
    email,
    role: body.role,
  };
}

export async function login(app: INestApplication, email: string, password = PASSWORD) {
  const res = await new Api(app).post('/auth/login', { email, password });
  return res;
}

/** Token de un enlace de invitación (`.../invitacion/<token>`). */
export function invitationToken(acceptUrl: string): string {
  return acceptUrl.slice(acceptUrl.lastIndexOf('/') + 1);
}

/**
 * Invita a un usuario nuevo al workspace del administrador, acepta la invitación por API (crea la cuenta con
 * contraseña, C1) e inicia sesión con él.
 */
export async function addMember(
  app: INestApplication,
  admin: Session,
  opts: { role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER'; orgUnitId?: string; tag?: string },
): Promise<Session> {
  const email = uniqueEmail(opts.tag ?? opts.role.toLowerCase());
  const invited = await admin.api
    .post('/admin/org/members', {
      email,
      name: `Miembro ${opts.role}`,
      role: opts.role,
      ...(opts.orgUnitId ? { orgUnitId: opts.orgUnitId } : {}),
    })
    .expect(201);
  const accepted = await new Api(app)
    .post(`/auth/invitations/${invitationToken((invited.body as { acceptUrl: string }).acceptUrl)}/accept`, {
      password: PASSWORD,
    })
    .expect(200);
  const res = await login(app, email);
  expect(res.status).toBe(200);
  const body = res.body as { accessToken: string; workspaceId: string; role: string };
  expect(body.workspaceId).toBe(admin.workspaceId);
  const { userId, membershipId } = accepted.body as { userId: string; membershipId: string };
  return {
    api: new Api(app, body.accessToken),
    token: body.accessToken,
    workspaceId: body.workspaceId,
    userId,
    email,
    role: body.role,
    membershipId,
  };
}

export interface AdminUnit {
  id: string;
  name: string;
  code: string | null;
  parentId: string | null;
  allowedModels: string[];
  memberCount: number;
  isRoot: boolean;
}

export async function adminUnits(s: Session): Promise<AdminUnit[]> {
  return (await s.api.get('/admin/org/units').expect(200)).body as AdminUnit[];
}

export async function rootUnit(s: Session): Promise<AdminUnit> {
  const root = (await adminUnits(s)).find((u) => u.isRoot);
  if (!root) throw new Error('El workspace no tiene unidad raíz');
  return root;
}

export async function createUnit(s: Session, name: string, parentId: string): Promise<{ id: string; name: string }> {
  return (await s.api.post('/admin/org/units', { name, parentId }).expect(201)).body as { id: string; name: string };
}

export interface AgentBody {
  name?: string;
  provider?: string;
  model?: string;
  systemPrompt?: string;
  costCenterId?: string | null;
  maxTurns?: number;
  fallbackModels?: string[];
}

export async function createAgent(
  s: Session,
  body: AgentBody = {},
): Promise<{ id: string; costCenterId: string | null }> {
  const res = await s.api
    .post('/agents', { name: 'Agente E2E', provider: 'mock', model: 'mock-echo', ...body })
    .expect(201);
  return res.body as { id: string; costCenterId: string | null };
}

export interface ChatResult {
  conversationId: string;
  text: string;
  providerId: string;
  model: string;
  turns: number;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

export async function chat(s: Session, agentId: string, message = 'Hola, agente'): Promise<ChatResult> {
  const res = await s.api.post(`/agents/${agentId}/chat`, { message });
  if (res.status !== 200) throw new Error(`Chat respondió ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as ChatResult;
}

export interface UsageSummary {
  from: string;
  to: string;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  groups: { key: string; label: string; costUsd: number; inputTokens: number; outputTokens: number; calls: number }[];
}

export async function summary(s: Session, groupBy = 'orgUnit'): Promise<UsageSummary> {
  return (await s.api.get(`/admin/usage/summary?groupBy=${groupBy}`).expect(200)).body as UsageSummary;
}

export interface UsageRecordItem {
  id: string;
  source: string;
  model: string;
  providerId: string;
  orgUnitName: string | null;
  userName: string | null;
  agentName: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export async function records(s: Session): Promise<UsageRecordItem[]> {
  return ((await s.api.get('/admin/usage/records?take=100').expect(200)).body as { items: UsageRecordItem[] }).items;
}

/** Mensaje largo para que una sola llamada al mock supere un presupuesto mínimo (≈ 0.0003 USD con mock-echo). */
export const LONG_MESSAGE = 'Consumo de prueba para agotar el presupuesto. '.repeat(10);

/**
 * Publica el agente para toda la empresa (ADR 0007): lo lanza con override (requiere ADMIN/OWNER) y lo pasa a
 * WORKSPACE. Reproduce el modelo anterior a ADR 0007 en pruebas que comparten un agente entre roles.
 */
export async function publishAgent(admin: Session, agentId: string): Promise<void> {
  await admin.api.post(`/agents/${agentId}/launch`, { override: true, reason: 'Prueba E2E' }).expect(200);
  await admin.api.patch(`/agents/${agentId}/visibility`, { visibility: 'WORKSPACE' }).expect(200);
}

export interface ShareBody {
  principalType: 'USER' | 'UNIT' | 'GROUP';
  principalId: string;
  permission: 'USE' | 'EDIT';
}

/** Pasa el agente a TEAM y reemplaza sus shares. */
export async function shareAgent(s: Session, agentId: string, shares: ShareBody[]): Promise<void> {
  await s.api.patch(`/agents/${agentId}/visibility`, { visibility: 'TEAM' }).expect(200);
  await s.api.put(`/agents/${agentId}/shares`, { shares }).expect(200);
}

export interface GroupView {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  members: { userId: string; name: string; email: string }[];
  createdAt: string;
}

/** Crea un grupo de usuarios (ADR 0007 D6) como ADMIN/OWNER. */
export async function createGroup(
  admin: Session,
  body: { name: string; description?: string; userIds?: string[] },
): Promise<GroupView> {
  return (await admin.api.post('/admin/groups', body).expect(201)).body as GroupView;
}
