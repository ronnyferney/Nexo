import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  AportarInfoInput,
  CancelarInput,
  ConciliarInput,
  Excepcion,
  ExcepcionDetalle,
  ExcepcionesFiltro,
  ReasignarInput,
} from './excepciones.models';

/**
 * Fachada tipada de la bandeja de excepciones (E7 · RF20/RF21). Las páginas nunca usan `HttpClient`: consumen estos
 * métodos. Rutas del módulo `durability/excepciones`: lista y detalle (cualquier miembro) y las mutaciones
 * (aportar info, reintentar, reasignar, cancelar, conciliar) que el servidor exige a EDITOR+. Todo filtra por
 * `workspaceId` del token en el backend.
 */
@Injectable({ providedIn: 'root' })
export class ExcepcionesApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  private getJson<T>(path: string, params?: Record<string, string>) {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`, params ? { params } : {}));
  }
  private postJson<T>(path: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(`${this.base}${path}`, body));
  }

  /** Lista de la bandeja. El backend admite filtrar por estado y tarea; el resto se filtra en la vista. */
  list = (filtro: ExcepcionesFiltro = {}) => {
    const params: Record<string, string> = {};
    if (filtro.estado) params['estado'] = filtro.estado;
    if (filtro.tareaId) params['tareaId'] = filtro.tareaId;
    return this.getJson<Excepcion[]>('/excepciones', Object.keys(params).length ? params : undefined);
  };

  /** Detalle con el historial de eventos append-only. */
  get = (id: string) => this.getJson<ExcepcionDetalle>(`/excepciones/${id}`);

  // Mutaciones (EDITOR+). Devuelven la excepción actualizada (sin los eventos; recargar el detalle para el historial).
  aportarInfo = (id: string, body: AportarInfoInput) => this.postJson<Excepcion>(`/excepciones/${id}/info`, body);
  reintentar = (id: string) => this.postJson<Excepcion>(`/excepciones/${id}/reintentar`);
  reasignar = (id: string, body: ReasignarInput) => this.postJson<Excepcion>(`/excepciones/${id}/reasignar`, body);
  cancelar = (id: string, body: CancelarInput) => this.postJson<Excepcion>(`/excepciones/${id}/cancelar`, body);
  conciliar = (id: string, body: ConciliarInput) => this.postJson<Excepcion>(`/excepciones/${id}/conciliar`, body);
}
