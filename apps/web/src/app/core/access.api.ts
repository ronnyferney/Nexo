import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type { AgentHealth, AgentHealthSummary, AgentShareInput, AgentVisibility, LaunchInput } from './access.models';
import { normalizeHealthSummary } from './access.models';
import type { Agent } from './models';

/** Fachada de visibilidad, compartir, salud y lanzamiento de agentes (ADR 0006 D3/D4 y ADR 0007). */
@Injectable({ providedIn: 'root' })
export class AccessApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  private get<T>(path: string) {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`));
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

  // Visibilidad y compartir (ADR 0007)
  setVisibility = (agentId: string, visibility: AgentVisibility) =>
    this.patch<Agent>(`/agents/${agentId}/visibility`, { visibility });
  setShares = (agentId: string, shares: AgentShareInput[]) => this.put<Agent>(`/agents/${agentId}/shares`, { shares });
  transfer = (agentId: string, userId: string) => this.post<Agent>(`/agents/${agentId}/transfer`, { userId });
  duplicate = (agentId: string, name?: string) =>
    this.post<Agent>(`/agents/${agentId}/duplicate`, name?.trim() ? { name: name.trim() } : {});

  // Salud y lanzamiento (ADR 0006 D3/D4)
  health = (agentId: string) => this.get<AgentHealth>(`/agents/${agentId}/health`);
  healthSummary = async (): Promise<AgentHealthSummary[]> => normalizeHealthSummary(await this.get<unknown>('/agents/health'));
  launch = (agentId: string, data: LaunchInput = {}) => this.post<Agent>(`/agents/${agentId}/launch`, data);
  unlaunch = (agentId: string) => this.post<Agent>(`/agents/${agentId}/unlaunch`);
}
