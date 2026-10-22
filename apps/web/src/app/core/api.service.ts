import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import type {
  Agent,
  AgentStreamEvent,
  Connector,
  Execution,
  Operation,
  ProviderInfo,
  Stats,
  Workflow,
} from './models';

/** Fachada tipada sobre la API REST de Nexo. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly base = environment.apiUrl;

  private get<T>(path: string, params?: Record<string, string>) {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`, { params }));
  }
  private post<T>(path: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(`${this.base}${path}`, body));
  }
  private patch<T>(path: string, body: unknown) {
    return firstValueFrom(this.http.patch<T>(`${this.base}${path}`, body));
  }
  private put<T>(path: string, body: unknown) {
    return firstValueFrom(this.http.put<T>(`${this.base}${path}`, body));
  }
  private delete<T>(path: string) {
    return firstValueFrom(this.http.delete<T>(`${this.base}${path}`));
  }

  // Workspace
  stats = () => this.get<Stats>('/workspace/stats');
  secrets = () => this.get<{ id: string; name: string; updatedAt: string }[]>('/workspace/secrets');
  upsertSecret = (name: string, value: string) => this.put('/workspace/secrets', { name, value });
  deleteSecret = (id: string) => this.delete(`/workspace/secrets/${id}`);
  apiKeys = () => this.get<{ id: string; name: string; prefix: string; lastUsedAt?: string; createdAt: string }[]>('/workspace/api-keys');
  createApiKey = (name: string) => this.post<{ id: string; name: string; key: string }>('/workspace/api-keys', { name });
  deleteApiKey = (id: string) => this.delete(`/workspace/api-keys/${id}`);

  // Conectores
  connectors = () => this.get<Connector[]>('/connectors');
  connector = (id: string) => this.get<Connector>(`/connectors/${id}`);
  createConnector = (data: Partial<Connector>) => this.post<Connector>('/connectors', data);
  updateConnector = (id: string, data: Partial<Connector>) => this.patch<Connector>(`/connectors/${id}`, data);
  deleteConnector = (id: string) => this.delete(`/connectors/${id}`);
  testConnector = (id: string) => this.post<{ ok: boolean; message: string }>(`/connectors/${id}/test`);
  discoverConnector = (id: string) => this.post<{ imported: number; operations: string[] }>(`/connectors/${id}/discover`);
  createOperation = (cid: string, data: Partial<Operation>) => this.post<Operation>(`/connectors/${cid}/operations`, data);
  updateOperation = (cid: string, id: string, data: Partial<Operation>) =>
    this.patch<Operation>(`/connectors/${cid}/operations/${id}`, data);
  deleteOperation = (cid: string, id: string) => this.delete(`/connectors/${cid}/operations/${id}`);
  invokeOperation = (cid: string, id: string, input: unknown) =>
    this.post<{ ok: boolean; status?: number; data: unknown; durationMs: number }>(`/connectors/${cid}/operations/${id}/invoke`, { input });

  // Agentes
  providers = () => this.get<ProviderInfo[]>('/agents/providers');
  agents = () => this.get<Agent[]>('/agents');
  agent = (id: string) => this.get<Agent>(`/agents/${id}`);
  createAgent = (data: Partial<Agent>) => this.post<Agent>('/agents', data);
  updateAgent = (id: string, data: Partial<Agent>) => this.patch<Agent>(`/agents/${id}`, data);
  deleteAgent = (id: string) => this.delete(`/agents/${id}`);
  setAgentTools = (id: string, tools: { operationId: string; requiresApproval: boolean }[]) =>
    this.put<Agent>(`/agents/${id}/tools`, { tools });
  conversations = (id: string) => this.get<{ id: string; title: string; updatedAt: string }[]>(`/agents/${id}/conversations`);

  /** Chat con streaming SSE sobre fetch (EventSource no admite POST ni headers). */
  async chatStream(
    agentId: string,
    body: { message: string; conversationId?: string; approvedTools?: string[] },
    onEvent: (e: AgentStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch(`${this.base}/agents/${agentId}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.auth.token}` },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(Array.isArray(err.message) ? err.message.join(', ') : err.message);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = /^event: (.+)$/m.exec(chunk)?.[1];
        const data = /^data: (.+)$/m.exec(chunk)?.[1];
        if (event && data) onEvent({ ...JSON.parse(data), type: event } as AgentStreamEvent);
      }
    }
  }

  // Flujos
  workflows = () => this.get<Workflow[]>('/workflows');
  workflow = (id: string) => this.get<Workflow>(`/workflows/${id}`);
  createWorkflow = (data: Partial<Workflow>) => this.post<Workflow>('/workflows', data);
  updateWorkflow = (id: string, data: Partial<Workflow>) => this.patch<Workflow>(`/workflows/${id}`, data);
  deleteWorkflow = (id: string) => this.delete(`/workflows/${id}`);
  setWorkflowActive = (id: string, active: boolean) => this.post<Workflow>(`/workflows/${id}/active`, { active });
  runWorkflow = (id: string, input: unknown, wait = false) => this.post<Execution>(`/workflows/${id}/run`, { input, wait });
  regenerateWebhook = (id: string) => this.post<{ webhookToken: string }>(`/workflows/${id}/webhook/regenerate`);

  // Ejecuciones
  executions = (params: Record<string, string> = {}) =>
    this.get<{ items: Execution[]; nextCursor: string | null }>('/executions', params);
  execution = (id: string) => this.get<Execution>(`/executions/${id}`);
  cancelExecution = (id: string) => this.post<Execution>(`/executions/${id}/cancel`);
  retryExecution = (id: string) => this.post<Execution>(`/executions/${id}/retry`);
}

export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const m = err.error?.message;
    return Array.isArray(m) ? m.join(' · ') : (m ?? err.message);
  }
  return (err as Error)?.message ?? 'Error inesperado';
}
