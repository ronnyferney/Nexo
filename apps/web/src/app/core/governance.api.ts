import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  ApprovalDecisionInput,
  Aprobacion,
  DecisionPolitica,
  Politica,
  PoliticaInput,
  Suspension,
  SuspensionInput,
} from './governance.models';

/**
 * Fachada tipada del gobierno de acciones (E6 · ADR 0013). Las páginas nunca usan `HttpClient`: consumen estos métodos.
 * Rutas del módulo `governance/actions`: bandeja de aprobaciones (`/approvals`), políticas versionadas
 * (`/admin/policies`, ADMIN) y suspensión de emergencia (`/admin/suspensions`, ADMIN).
 */
@Injectable({ providedIn: 'root' })
export class GovernanceApi {
  private readonly http = inject(HttpClient);
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
  private delete<T>(path: string) {
    return firstValueFrom(this.http.delete<T>(`${this.base}${path}`));
  }

  // Aprobaciones (RF12). Listar: cualquier miembro. Decidir: EDITOR+ (nunca el solicitante).
  approvals = (estado?: string) => this.get<Aprobacion[]>('/approvals', estado ? { estado } : undefined);
  approval = (id: string) => this.get<Aprobacion>(`/approvals/${id}`);
  decideApproval = (id: string, body: ApprovalDecisionInput) =>
    this.post<Aprobacion>(`/approvals/${id}/decision`, body);

  // Políticas (RF11, ADMIN). CRUD versionado + auditoría de decisiones registradas.
  policies = (filtro: { tipoAccion?: string; estado?: string } = {}) => {
    const params: Record<string, string> = {};
    if (filtro.tipoAccion) params['tipoAccion'] = filtro.tipoAccion;
    if (filtro.estado) params['estado'] = filtro.estado;
    return this.get<Politica[]>('/admin/policies', params);
  };
  policyDecisions = () => this.get<DecisionPolitica[]>('/admin/policies/decisions');
  policy = (id: string) => this.get<Politica>(`/admin/policies/${id}`);
  createPolicy = (body: PoliticaInput) => this.post<Politica>('/admin/policies', body);
  updatePolicy = (id: string, body: Partial<PoliticaInput>) => this.patch<Politica>(`/admin/policies/${id}`, body);
  archivePolicy = (id: string) => this.delete<Politica>(`/admin/policies/${id}`);

  // Suspensión de emergencia (RF13, ADMIN). Crear/listar/reactivar (con motivo).
  suspensions = (soloActivas = false) =>
    this.get<Suspension[]>('/admin/suspensions', soloActivas ? { activas: 'true' } : undefined);
  createSuspension = (body: SuspensionInput) => this.post<Suspension>('/admin/suspensions', body);
  reactivateSuspension = (id: string, motivo: string) =>
    this.post<Suspension>(`/admin/suspensions/${id}/reactivate`, { motivo });
}
