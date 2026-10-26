import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type { AuditEntry, AuditFilters, AuditPage, AuditVerification } from './audit.models';

/**
 * Fachada tipada del visor de auditoría inmutable (E13). Espeja el contrato del backend (`modules/audit/audit.controller`):
 * SOLO LECTURA (no hay creación/edición/borrado) y rol ADMIN. Las páginas nunca usan `HttpClient`: consumen estos
 * métodos y muestran los errores con `errorMessage()` + `ToastService`. `workspaceId` lo pone el servidor desde el
 * token; nunca viaja en la query.
 */
@Injectable({ providedIn: 'root' })
export class AuditApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  private httpGet<T>(path: string, params?: Record<string, string>) {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`, params ? { params } : {}));
  }

  /** Lista paginada y filtrable (orden descendente por `seq`). `cursor` es el `id` de la última entrada de la página. */
  listar(filtros: AuditFilters = {}, opts: { take?: number; cursor?: string | null } = {}): Promise<AuditPage> {
    const params: Record<string, string> = { take: String(opts.take ?? 50) };
    if (filtros.action) params['action'] = filtros.action;
    if (filtros.targetType) params['targetType'] = filtros.targetType;
    if (filtros.targetId) params['targetId'] = filtros.targetId;
    if (filtros.desde) params['desde'] = filtros.desde;
    if (filtros.hasta) params['hasta'] = filtros.hasta;
    if (opts.cursor) params['cursor'] = opts.cursor;
    return this.httpGet<AuditPage>('/auditoria', params);
  }

  /** Corre `verificarCadena` del workspace: el sello de integridad de toda la cadena. */
  verificar(): Promise<AuditVerification> {
    return this.httpGet<AuditVerification>('/auditoria/verificacion');
  }

  /** Detalle de una entrada por id (por si se enlaza desde otra vista). */
  get(id: string): Promise<AuditEntry> {
    return this.httpGet<AuditEntry>(`/auditoria/${encodeURIComponent(id)}`);
  }
}
