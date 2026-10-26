import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  CreateCrewInput,
  CreateCrewVersionInput,
  CrewDetail,
  CrewEstado,
  CrewInstance,
  CrewSummary,
  CrewVersion,
  InstantiateCrewInput,
  InstantiateResult,
} from './crews.models';

/**
 * Fachada tipada de Cuadrillas (ADR 0014 · D1 · E11). Espeja el contrato del backend (`modules/crews`). Lectura del
 * catálogo para cualquier miembro del workspace; definir/versionar/publicar/retirar exige ADMIN e instanciar EDITOR+
 * (lo decide el servidor). Instanciar NO concede acceso: devuelve los permisos pendientes de conceder a mano.
 */
@Injectable({ providedIn: 'root' })
export class CrewsApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  private get<T>(path: string, params?: Record<string, string>) {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`, { params }));
  }
  private post<T>(path: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(`${this.base}${path}`, body));
  }

  /** Catálogo del workspace. Filtra por estado si se indica. */
  list = (estado?: CrewEstado) => this.get<CrewSummary[]>('/crews', estado ? { estado } : undefined);
  /** Detalle con versiones y miembros. */
  get_ = (id: string) => this.get<CrewDetail>(`/crews/${id}`);
  /** Instancias creadas de la plantilla. */
  instances = (id: string) => this.get<CrewInstance[]>(`/crews/${id}/instances`);

  /** Crea una plantilla en BORRADOR (ADMIN). */
  create = (data: CreateCrewInput) => this.post<CrewDetail>('/crews', data);
  /** Agrega una versión append-only con sus miembros (ADMIN). */
  addVersion = (id: string, data: CreateCrewVersionInput) => this.post<CrewVersion>(`/crews/${id}/versions`, data);
  /** BORRADOR → PUBLICADA (ADMIN). */
  publish = (id: string) => this.post<CrewDetail>(`/crews/${id}/publish`);
  /** → RETIRADA (ADMIN). */
  retire = (id: string) => this.post<CrewDetail>(`/crews/${id}/retire`);
  /** Instancia una versión PUBLICADA (EDITOR+). No concede acceso. */
  instantiate = (id: string, data: InstantiateCrewInput) =>
    this.post<InstantiateResult>(`/crews/${id}/instantiate`, data);
}
