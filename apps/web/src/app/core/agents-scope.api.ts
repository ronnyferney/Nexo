import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type { AgentScope, ExploreAgent, ScopedAgent, WorkspaceSettings } from './agents-scope.models';

/**
 * Lista por ámbito, galería Explorar y ajustes del workspace (ADR 0007).
 * Duplicar, salud y lanzamiento viven en `AccessApi` (`core/access.api.ts`).
 */
@Injectable({ providedIn: 'root' })
export class AgentsScopeApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  agents = (scope?: AgentScope) =>
    firstValueFrom(this.http.get<ScopedAgent[]>(`${this.base}/agents`, { params: scope ? { scope } : {} }));
  explore = () => firstValueFrom(this.http.get<ExploreAgent[]>(`${this.base}/agents/explore`));

  workspaceSettings = () => firstValueFrom(this.http.get<WorkspaceSettings>(`${this.base}/workspace/settings`));
  updateWorkspaceSettings = (data: Partial<WorkspaceSettings>) =>
    firstValueFrom(this.http.patch<WorkspaceSettings>(`${this.base}/workspace/settings`, data));
}
