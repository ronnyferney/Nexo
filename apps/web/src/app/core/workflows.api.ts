import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type { Workflow, WorkflowEdge, WorkflowNode } from './models';

/** Entrada de `GET /workflows/:id/versions` (ADR 0003 D6.4). */
export interface WorkflowVersionInfo {
  version: number;
  createdAt: string;
  nodeCount: number;
  /** La API incluye la versión vigente marcada con `current: true`. */
  current?: boolean;
  /** Opcional: algunas respuestas pueden incluir la definición completa de la versión. */
  definition?: { nodes: WorkflowNode[]; edges: WorkflowEdge[] };
}

/** Cuerpo de `POST /workflows/:id/nodes/:nodeId/test` (ADR 0003 D6.5). */
export interface NodeTestInput {
  input?: unknown;
  /** Salidas simuladas de nodos previos, por id de nodo. */
  pinned?: Record<string, unknown>;
}

export interface NodeTestResult {
  ok: boolean;
  output: unknown;
  error: string | null;
  durationMs: number;
}

/** Endpoints de flujos introducidos por ADR 0003: versiones, restauración y prueba de nodos. */
@Injectable({ providedIn: 'root' })
export class WorkflowsApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  versions = (id: string) =>
    firstValueFrom(this.http.get<WorkflowVersionInfo[]>(`${this.base}/workflows/${id}/versions`));

  /** `GET /workflows/:id/versions/:version` → versión con su definición completa. */
  version = (id: string, version: number) =>
    firstValueFrom(this.http.get<WorkflowVersionInfo>(`${this.base}/workflows/${id}/versions/${version}`));

  restoreVersion = (id: string, version: number) =>
    firstValueFrom(this.http.post<Workflow>(`${this.base}/workflows/${id}/versions/${version}/restore`, {}));

  testNode = (id: string, nodeId: string, body: NodeTestInput) =>
    firstValueFrom(
      this.http.post<NodeTestResult>(`${this.base}/workflows/${id}/nodes/${encodeURIComponent(nodeId)}/test`, body),
    );
}
