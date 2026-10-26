import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  CanalCuenta,
  CreateCanalCuentaInput,
  EnviarMensajeInput,
  MensajeCanal,
  ResultadoPruebaCanal,
  UpdateCanalCuentaInput,
} from './channels.models';

/**
 * Fachada tipada de los canales EXTERNOS (E14 · ADR 0015): CRUD de cuentas de canal por empresa, prueba del
 * adaptador y envío idempotente de mensajes en sandbox. Ruta base `/canales-externos` (NO `/canales`, que es la
 * coordinación interna de agentes de E5). `workspaceId` lo deriva la API de la sesión, nunca del cuerpo.
 */
@Injectable({ providedIn: 'root' })
export class ChannelsApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/canales-externos`;

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

  // Cuentas de canal
  cuentas = () => this.get<CanalCuenta[]>('');
  cuenta = (id: string) => this.get<CanalCuenta>(`/${id}`);
  createCuenta = (data: CreateCanalCuentaInput) => this.post<CanalCuenta>('', data);
  updateCuenta = (id: string, data: UpdateCanalCuentaInput) => this.patch<CanalCuenta>(`/${id}`, data);
  removeCuenta = (id: string) => this.delete<{ removed: true }>(`/${id}`);
  testCuenta = (id: string) => this.post<ResultadoPruebaCanal>(`/${id}/test`);

  // Mensajes
  enviar = (id: string, data: EnviarMensajeInput) => this.post<MensajeCanal>(`/${id}/enviar`, data);
  mensajes = (id: string, estado?: string) =>
    this.get<MensajeCanal[]>(`/${id}/mensajes`, estado ? { estado } : undefined);
}
