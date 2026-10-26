import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  AnalisisQuery,
  AnalisisResult,
  Dimension,
  DimensionAssignment,
  DimensionAssignmentInput,
  DimensionCreateInput,
  DimensionUpdateInput,
  DimensionValue,
  DimensionValueCreateInput,
  DimensionValueUpdateInput,
} from './dimensiones.models';

/**
 * Fachada tipada del marco de dimensiones configurables y la consola de análisis (ADR 0011 D8 · E1b): dimensiones,
 * valores (árbol), etiquetado y el pivot de consumo. Lectura para cualquier miembro del workspace; las mutaciones
 * exigen EDITOR+ (el servidor es el gate real) y las dimensiones de sistema son solo lectura. Las páginas consumen
 * siempre esta fachada, nunca `HttpClient` directo.
 */
@Injectable({ providedIn: 'root' })
export class DimensionesApi {
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

  // Dimensiones
  dimensiones = (empresaId?: string) =>
    this.get<Dimension[]>('/dimensiones', empresaId ? { empresaId } : undefined);
  dimension = (id: string) => this.get<Dimension>(`/dimensiones/${id}`);
  createDimension = (data: DimensionCreateInput) => this.post<Dimension>('/dimensiones', data);
  updateDimension = (id: string, data: DimensionUpdateInput) => this.patch<Dimension>(`/dimensiones/${id}`, data);
  deleteDimension = (id: string) => this.delete<void>(`/dimensiones/${id}`);

  // Valores (árbol)
  valores = (dimensionId: string) => this.get<DimensionValue[]>(`/dimensiones/${dimensionId}/valores`);
  createValor = (dimensionId: string, data: DimensionValueCreateInput) =>
    this.post<DimensionValue>(`/dimensiones/${dimensionId}/valores`, data);
  updateValor = (dimensionId: string, valorId: string, data: DimensionValueUpdateInput) =>
    this.patch<DimensionValue>(`/dimensiones/${dimensionId}/valores/${valorId}`, data);
  deleteValor = (dimensionId: string, valorId: string) =>
    this.delete<void>(`/dimensiones/${dimensionId}/valores/${valorId}`);

  // Etiquetado
  asignaciones = (dimensionId: string, filtro: { targetType?: string; targetId?: string } = {}) => {
    const params: Record<string, string> = {};
    if (filtro.targetType) params['targetType'] = filtro.targetType;
    if (filtro.targetId) params['targetId'] = filtro.targetId;
    return this.get<DimensionAssignment[]>(`/dimensiones/${dimensionId}/asignaciones`, params);
  };
  asignar = (dimensionId: string, data: DimensionAssignmentInput) =>
    this.post<DimensionAssignment>(`/dimensiones/${dimensionId}/asignaciones`, data);
  quitarAsignacion = (asignacionId: string) => this.delete<void>(`/dimensiones/asignaciones/${asignacionId}`);

  // Consola de análisis (pivot)
  analisis = (query: AnalisisQuery) => {
    const params: Record<string, string> = { groupBy: query.groupBy };
    if (query.from) params['from'] = query.from;
    if (query.to) params['to'] = query.to;
    return this.get<AnalisisResult>('/consolas/analisis', params);
  };
}
