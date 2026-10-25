import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  AsignacionCreateInput,
  AsignacionFilter,
  AsignacionOrganizacional,
  AsignacionUpdateInput,
  CentroCosto,
  CentroCostoCreateInput,
  CentroCostoUpdateInput,
  LineaNegocio,
  LineaNegocioCreateInput,
  LineaNegocioUpdateInput,
  Sede,
  SedeCreateInput,
  SedeUpdateInput,
} from './estructura.models';

/**
 * Fachada tipada de la estructura empresarial (ADR 0011 E1): líneas de negocio, sedes, centros de costo y la matriz de
 * asignaciones. Lectura para cualquier miembro del workspace; las mutaciones exigen EDITOR+ (el servidor es el gate
 * real). El árbol tipado de `OrgUnit` (grupo/empresa/área…) se consume por `ApiService.adminOrgUnits()`.
 */
@Injectable({ providedIn: 'root' })
export class EstructuraApi {
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

  private byEmpresa(empresaId?: string): Record<string, string> {
    return empresaId ? { empresaId } : {};
  }

  // Líneas de negocio
  lineas = (empresaId?: string) => this.get<LineaNegocio[]>('/estructura/lineas-negocio', this.byEmpresa(empresaId));
  createLinea = (data: LineaNegocioCreateInput) => this.post<LineaNegocio>('/estructura/lineas-negocio', data);
  updateLinea = (id: string, data: LineaNegocioUpdateInput) =>
    this.patch<LineaNegocio>(`/estructura/lineas-negocio/${id}`, data);
  deleteLinea = (id: string) => this.delete<void>(`/estructura/lineas-negocio/${id}`);

  // Sedes
  sedes = (empresaId?: string) => this.get<Sede[]>('/estructura/sedes', this.byEmpresa(empresaId));
  createSede = (data: SedeCreateInput) => this.post<Sede>('/estructura/sedes', data);
  updateSede = (id: string, data: SedeUpdateInput) => this.patch<Sede>(`/estructura/sedes/${id}`, data);
  deleteSede = (id: string) => this.delete<void>(`/estructura/sedes/${id}`);

  // Centros de costo
  centros = (empresaId?: string) => this.get<CentroCosto[]>('/estructura/centros-costo', this.byEmpresa(empresaId));
  createCentro = (data: CentroCostoCreateInput) => this.post<CentroCosto>('/estructura/centros-costo', data);
  updateCentro = (id: string, data: CentroCostoUpdateInput) =>
    this.patch<CentroCosto>(`/estructura/centros-costo/${id}`, data);
  deleteCentro = (id: string) => this.delete<void>(`/estructura/centros-costo/${id}`);

  // Asignaciones (matriz)
  asignaciones = (filtro: AsignacionFilter = {}) => {
    const params: Record<string, string> = {};
    if (filtro.agentId) params['agentId'] = filtro.agentId;
    if (filtro.userId) params['userId'] = filtro.userId;
    if (filtro.lineaNegocioId) params['lineaNegocioId'] = filtro.lineaNegocioId;
    return this.get<AsignacionOrganizacional[]>('/estructura/asignaciones', params);
  };
  createAsignacion = (data: AsignacionCreateInput) =>
    this.post<AsignacionOrganizacional>('/estructura/asignaciones', data);
  updateAsignacion = (id: string, data: AsignacionUpdateInput) =>
    this.patch<AsignacionOrganizacional>(`/estructura/asignaciones/${id}`, data);
  deleteAsignacion = (id: string) => this.delete<void>(`/estructura/asignaciones/${id}`);
}
