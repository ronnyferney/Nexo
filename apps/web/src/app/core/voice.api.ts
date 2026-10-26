import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  CreateVozCuentaInput,
  IniciarLlamadaInput,
  ResultadoFinalizar,
  ResultadoTransferencia,
  ResultadoTurno,
  TransferirLlamadaInput,
  TurnoLlamadaInput,
  VozCuenta,
  VozLlamada,
} from './voice.models';

/**
 * Fachada tipada del dominio «voz» (E14 · ADR 0015 D2), sandbox SIN gasto. Espeja el contrato de `/voz`: cuentas de voz
 * por empresa (crear exige ADMIN) y el ciclo de una llamada (iniciar/turno/transferir/finalizar exige EDITOR; listar
 * exige VIEWER). `workspaceId` lo deriva la API de la sesión, nunca del cuerpo. Las credenciales se referencian por
 * `secretRef` (nombre de clave de bóveda), NUNCA el secreto en claro.
 */
@Injectable({ providedIn: 'root' })
export class VoiceApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/voz`;

  private get<T>(path: string, params?: Record<string, string>) {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`, { params }));
  }
  private post<T>(path: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(`${this.base}${path}`, body));
  }

  // Cuentas de voz
  cuentas = () => this.get<VozCuenta[]>('/cuentas');
  cuenta = (id: string) => this.get<VozCuenta>(`/cuentas/${id}`);
  createCuenta = (data: CreateVozCuentaInput) => this.post<VozCuenta>('/cuentas', data);

  // Llamadas
  llamadas = (cuentaId: string, estado?: string) =>
    this.get<VozLlamada[]>('/llamadas', estado ? { cuentaId, estado } : { cuentaId });
  llamada = (callId: string) => this.get<VozLlamada>(`/llamadas/${callId}`);
  iniciar = (data: IniciarLlamadaInput) => this.post<VozLlamada>('/llamadas', data);
  turno = (callId: string, data: TurnoLlamadaInput) => this.post<ResultadoTurno>(`/llamadas/${callId}/turno`, data);
  transferir = (callId: string, data: TransferirLlamadaInput) =>
    this.post<ResultadoTransferencia>(`/llamadas/${callId}/transferir`, data);
  finalizar = (callId: string) => this.post<ResultadoFinalizar>(`/llamadas/${callId}/finalizar`);
}
