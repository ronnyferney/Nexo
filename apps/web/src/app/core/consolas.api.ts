import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type { ConsolaGerencial, ConsolaGerencialFiltro } from './consolas.models';

/**
 * Fachada tipada de la consola gerencial (E12). Las páginas nunca usan `HttpClient`: consumen este método. Espeja el
 * contrato del backend (`GET /consolas/gerencial`, rol mínimo ADMIN). Solo lectura; el servidor es el gate real de rol
 * y el responsable de filtrar por `workspaceId` (multi-tenant).
 */
@Injectable({ providedIn: 'root' })
export class ConsolasApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** Resumen ejecutivo del alcance/período. Sin `from`/`to` el backend usa una ventana de 30 días. */
  consolaGerencial = (filtro: ConsolaGerencialFiltro = {}) => {
    const params: Record<string, string> = {};
    if (filtro.from) params['from'] = filtro.from;
    if (filtro.to) params['to'] = filtro.to;
    if (filtro.empresaId) params['empresaId'] = filtro.empresaId;
    if (filtro.areaId) params['areaId'] = filtro.areaId;
    if (filtro.agentId) params['agentId'] = filtro.agentId;
    return firstValueFrom(this.http.get<ConsolaGerencial>(`${this.base}/consolas/gerencial`, { params }));
  };
}
