import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type { CadenaMando, NodoArbol, NodoOrganigrama } from './hierarchy.models';

/**
 * Fachada tipada del organigrama / línea de mando de empleados digitales (E3/RF32). Espeja el contrato del backend
 * (`modules/hierarchy/hierarchy.controller`). Las páginas nunca usan `HttpClient`: consumen estos métodos y muestran
 * los errores con `errorMessage()` + `ToastService`. El servidor es el gate real de rol (VIEWER+ para leer, ADMIN para
 * fijar la línea de mando) y de las reglas de integridad (sin ciclos, nivel coherente, mismo workspace).
 */
@Injectable({ providedIn: 'root' })
export class HierarchyApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  private httpGet<T>(path: string) {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`));
  }
  private httpPut<T>(path: string, body: unknown) {
    return firstValueFrom(this.http.put<T>(`${this.base}${path}`, body));
  }

  /** Organigrama del workspace como árbol (raíces con subordinados anidados). Rol VIEWER+. */
  organigrama = () => this.httpGet<NodoArbol[]>('/hierarchy');

  /** Cadena de mando ascendente de un agente (del supervisor directo hasta la raíz). Rol VIEWER+. */
  cadenaMando = (agentId: string) => this.httpGet<CadenaMando>(`/hierarchy/${encodeURIComponent(agentId)}/cadena-mando`);

  /** Fija o cambia a quién reporta un agente (`null` = raíz / sin supervisor). Rol ADMIN. */
  setSupervisor = (agentId: string, reportaAAgentId: string | null) =>
    this.httpPut<NodoOrganigrama>(`/hierarchy/${encodeURIComponent(agentId)}/reporta-a`, { reportaAAgentId });
}
