import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  AceptarHandoffInput,
  ContratoTransferencia,
  EnviarMensajeInput,
  HechoMensajeInput,
  MensajeAgente,
  MensajeFiltro,
  ProponerHandoffInput,
  RechazarHandoffInput,
} from './messaging.models';

/**
 * Fachada tipada del protocolo de comunicación entre agentes y del handoff (E5 · RF35/RF09/RF33). Espeja el contrato
 * del backend (`modules/messaging`): bandeja y envío de mensajes idempotentes por `messageId`, hechos del ciclo de
 * vida (recibir/aceptar/resolver) y continuidad de tarea (proponer/aceptar/rechazar un `ContratoTransferencia`).
 * Lectura para cualquier miembro del workspace; las mutaciones exigen EDITOR+ (el servidor decide).
 */
@Injectable({ providedIn: 'root' })
export class MessagingApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  private get<T>(path: string, params?: Record<string, string>) {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`, { params }));
  }
  private post<T>(path: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(`${this.base}${path}`, body));
  }

  // ===================== Mensajes (RF35) =====================
  mensajes = (filtro: MensajeFiltro = {}) => {
    const params: Record<string, string> = {};
    if (filtro.correlationId) params['correlationId'] = filtro.correlationId;
    if (filtro.tareaId) params['tareaId'] = filtro.tareaId;
    if (filtro.destinatarioAgentId) params['destinatarioAgentId'] = filtro.destinatarioAgentId;
    return this.get<MensajeAgente[]>('/mensajes', params);
  };
  mensaje = (id: string) => this.get<MensajeAgente>(`/mensajes/${id}`);
  /** Envía un mensaje (idempotente por `messageId`): una redelivery devuelve el existente sin otro efecto (QA11). */
  enviar = (data: EnviarMensajeInput) => this.post<MensajeAgente>('/mensajes', data);
  /** Marca el hecho de RECEPCIÓN (distinto del envío). */
  recibir = (id: string, data: HechoMensajeInput = {}) =>
    this.post<MensajeAgente>(`/mensajes/${id}/recibir`, data);
  /** Marca el hecho de ACEPTACIÓN. */
  aceptar = (id: string, data: HechoMensajeInput = {}) =>
    this.post<MensajeAgente>(`/mensajes/${id}/aceptar`, data);
  /** Marca el hecho de RESOLUCIÓN (cierre/entrega/devolución). Una DEVOLUCION exige motivo. */
  resolver = (id: string, data: HechoMensajeInput = {}) =>
    this.post<MensajeAgente>(`/mensajes/${id}/resolver`, data);

  // ===================== Handoff / transferencia (RF09/RF33) =====================
  transferencias = (tareaId: string) =>
    this.get<ContratoTransferencia[]>(`/tareas/${tareaId}/transferencias`);
  /** Propone un handoff sobre la tarea en un punto de corte (crea el contrato + un mensaje HANDOFF). */
  proponerHandoff = (tareaId: string, data: ProponerHandoffInput) =>
    this.post<ContratoTransferencia>(`/tareas/${tareaId}/handoff`, data);
  /** El receptor ACEPTA: encola el siguiente segmento desde el estado persistido (sin rehacer). */
  aceptarHandoff = (id: string, data: AceptarHandoffInput) =>
    this.post<ContratoTransferencia>(`/transferencias/${id}/aceptar`, data);
  /** El receptor RECHAZA con motivo: devuelve al emisor, no avanza la tarea. */
  rechazarHandoff = (id: string, data: RechazarHandoffInput) =>
    this.post<ContratoTransferencia>(`/transferencias/${id}/rechazar`, data);
}
