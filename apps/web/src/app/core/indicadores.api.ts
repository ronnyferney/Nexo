import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type { IndicadoresFiltro, IndicadoresResultados } from './indicadores.models';

/**
 * Fachada tipada del tablero de indicadores de resultado (E10). Las páginas nunca usan `HttpClient`: consumen este
 * método. Espeja el contrato del backend (`GET /indicadores/resultados`, rol mínimo VIEWER). Solo lectura; el
 * servidor es el gate real de rol y el responsable de filtrar por `workspaceId`.
 */
@Injectable({ providedIn: 'root' })
export class IndicadoresApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  private get<T>(path: string, params?: Record<string, string>) {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`, { params }));
  }

  /** Indicadores de resultado del período. Sin `from`/`to` el backend usa una ventana de 30 días. */
  indicadoresResultados = (filtro: IndicadoresFiltro = {}) => {
    const params: Record<string, string> = {};
    if (filtro.from) params['from'] = filtro.from;
    if (filtro.to) params['to'] = filtro.to;
    if (filtro.empresaId) params['empresaId'] = filtro.empresaId;
    if (filtro.areaId) params['areaId'] = filtro.areaId;
    if (filtro.agentId) params['agentId'] = filtro.agentId;
    return this.get<IndicadoresResultados>('/indicadores/resultados', params);
  };
}
