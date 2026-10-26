import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  EstacionVirtual,
  EstacionVirtualInput,
  EstacionVirtualUpdate,
  ParametrosEjecucion,
  SetParametrosEjecucion,
} from './execution-params.models';

/**
 * Fachada tipada de los parámetros de ejecución del empleado digital (E8): estaciones virtuales (recurso del
 * workspace) y parámetros de ejecución del agente (estación asignada, salida a internet y JSON extensible). Las
 * páginas nunca usan `HttpClient` directo: consumen esta fachada. El servidor es el gate real de rol (leer estaciones
 * y parámetros: VIEWER+; fijar parámetros: EDITOR+; crear/editar/retirar estaciones: ADMIN+) y filtra por
 * `workspaceId` (multi-tenant).
 */
@Injectable({ providedIn: 'root' })
export class ExecutionParamsApi {
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
  private delete<T>(path: string) {
    return firstValueFrom(this.http.delete<T>(`${this.base}${path}`));
  }

  // Estaciones virtuales
  estaciones = () => this.get<EstacionVirtual[]>('/estaciones-virtuales');
  estacion = (id: string) => this.get<EstacionVirtual>(`/estaciones-virtuales/${id}`);
  crearEstacion = (data: EstacionVirtualInput) => this.post<EstacionVirtual>('/estaciones-virtuales', data);
  actualizarEstacion = (id: string, data: EstacionVirtualUpdate) =>
    this.patch<EstacionVirtual>(`/estaciones-virtuales/${id}`, data);
  /** Baja lógica: la estación pasa a `RETIRADA` (no se borra). */
  retirarEstacion = (id: string) => this.delete<EstacionVirtual>(`/estaciones-virtuales/${id}`);

  // Parámetros de ejecución del agente
  parametros = (agentId: string) => this.get<ParametrosEjecucion>(`/execution-params/${agentId}`);
  guardarParametros = (agentId: string, data: SetParametrosEjecucion) =>
    this.put<ParametrosEjecucion>(`/execution-params/${agentId}`, data);
}
