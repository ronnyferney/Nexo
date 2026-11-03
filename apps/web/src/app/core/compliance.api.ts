import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  ContextoCumplimiento,
  CreateReglaCumplimientoInput,
  EvaluacionCumplimiento,
  ReglaCumplimiento,
  ReglaResuelta,
  UpdateReglaCumplimientoInput,
} from './compliance.models';

/**
 * Fachada tipada de la matriz de cumplimiento configurable (P1.3 · ADR 0020). Las páginas nunca usan `HttpClient`:
 * consumen estos métodos y muestran los errores con `errorMessage()` + `ToastService`. `workspaceId` lo pone el servidor
 * desde el token; nunca viaja en el cuerpo. CRUD GOBERNADO en `admin/compliance/rules` (solo ADMIN+); resolución y
 * evaluación ASESORA (no bloqueante) en `compliance` (VIEWER+).
 */
@Injectable({ providedIn: 'root' })
export class ComplianceApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  private get<T>(path: string, params?: Record<string, string>) {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`, params ? { params } : {}));
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

  // CRUD gobernado de reglas (ADMIN+). Listado de la más específica a la general.
  rules = () => this.get<ReglaCumplimiento[]>('/admin/compliance/rules');
  rule = (id: string) => this.get<ReglaCumplimiento>(`/admin/compliance/rules/${id}`);
  createRule = (body: CreateReglaCumplimientoInput) => this.post<ReglaCumplimiento>('/admin/compliance/rules', body);
  updateRule = (id: string, body: UpdateReglaCumplimientoInput) =>
    this.patch<ReglaCumplimiento>(`/admin/compliance/rules/${id}`, body);
  deleteRule = (id: string) => this.delete<void>(`/admin/compliance/rules/${id}`);

  /** Resuelve el conjunto de reglas aplicables a un contexto (la más específica suma). */
  resolve = (ctx: ContextoCumplimiento = {}, incluirInactivas = false) => {
    const params: Record<string, string> = {};
    if (ctx.jurisdiccion) params['jurisdiccion'] = ctx.jurisdiccion;
    if (ctx.sector) params['sector'] = ctx.sector;
    if (ctx.proceso) params['proceso'] = ctx.proceso;
    if (ctx.nivelRiesgo) params['nivelRiesgo'] = ctx.nivelRiesgo;
    if (incluirInactivas) params['incluirInactivas'] = 'true';
    return this.get<ReglaResuelta[]>('/compliance/resolve', params);
  };

  /** Evalúa de forma ASESORA (no bloqueante) un conjunto de valores contra las reglas ACTIVAS del contexto. */
  validate = (contexto: ContextoCumplimiento, valores: Record<string, unknown>) =>
    this.post<EvaluacionCumplimiento>('/compliance/validate', { contexto, valores });
}
