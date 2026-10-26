import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  ConsolidacionQuery,
  ConsolidacionResult,
  ImputacionCosto,
  ServicioInterno,
  ServicioInternoCreateInput,
  ServicioInternoUpdateInput,
  SetRepartoInput,
} from './imputacion.models';

/**
 * Fachada tipada de la imputación de costos (ADR 0011 D5/D7 · E9). Las páginas nunca usan `HttpClient`: consumen estos
 * métodos. Rutas del módulo `governance/imputacion`: servicios internos / compartidos y su reparto
 * (`/servicios-internos`, lectura cualquier miembro, mutaciones EDITOR+) y la consolidación económica
 * (`/consolidacion`, solo lectura). El servidor es el gate real de rol y de la invariante de suma 100 %.
 */
@Injectable({ providedIn: 'root' })
export class ImputacionApi {
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
  private put<T>(path: string, body: unknown) {
    return firstValueFrom(this.http.put<T>(`${this.base}${path}`, body));
  }
  private delete<T>(path: string, params?: Record<string, string>) {
    return firstValueFrom(this.http.delete<T>(`${this.base}${path}`, { params }));
  }

  // Servicios internos / compartidos (RF44). Listar/ver: cualquier miembro. Crear/editar/borrar: EDITOR+.
  servicios = (empresaId?: string) =>
    this.get<ServicioInterno[]>('/servicios-internos', empresaId ? { empresaId } : undefined);
  servicio = (id: string) => this.get<ServicioInterno>(`/servicios-internos/${id}`);
  createServicio = (data: ServicioInternoCreateInput) => this.post<ServicioInterno>('/servicios-internos', data);
  updateServicio = (id: string, data: ServicioInternoUpdateInput) =>
    this.patch<ServicioInterno>(`/servicios-internos/${id}`, data);
  deleteServicio = (id: string) => this.delete<void>(`/servicios-internos/${id}`);

  // Reparto del servicio (RF45). El reparto debe sumar 100 % sin destinos repetidos (gate en el backend).
  reparto = (id: string, periodoKey?: string) =>
    this.get<ImputacionCosto[]>(`/servicios-internos/${id}/imputaciones`, periodoKey ? { periodoKey } : undefined);
  setReparto = (id: string, data: SetRepartoInput) =>
    this.put<ImputacionCosto[]>(`/servicios-internos/${id}/imputaciones`, data);
  deleteReparto = (id: string, periodoKey: string) =>
    this.delete<void>(`/servicios-internos/${id}/imputaciones`, { periodoKey });

  // Consolidación económica (RF47 parcial). Solo lectura.
  consolidacion = (q: ConsolidacionQuery) => {
    const params: Record<string, string> = { dimension: q.dimension };
    if (q.from) params['from'] = q.from;
    if (q.to) params['to'] = q.to;
    if (q.empresaId) params['empresaId'] = q.empresaId;
    return this.get<ConsolidacionResult>('/consolidacion', params);
  };
}
