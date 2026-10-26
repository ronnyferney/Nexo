import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  CambioEstadoTareaInput,
  ContratoInput,
  ContratoResultado,
  EstadoResultadoAvance,
  Evidencia,
  EvidenciaInput,
  Incumplimiento,
  IncumplimientoInput,
  IntentoInput,
  Objetivo,
  ObjetivoInput,
  ResultadoValidacion,
  Tarea,
  TareaDetalle,
  TareaFiltro,
  TareaInput,
  ValidacionInput,
} from './results.models';

/**
 * Fachada tipada del trabajo por resultados (E4 · RF07/RF08/RF29/RF30/RF31): objetivos, tareas, contratos de
 * resultado, verificaciones, evidencias e incumplimientos. Espeja el contrato del backend (`modules/results`).
 * Lectura para cualquier miembro del workspace; las mutaciones y transiciones exigen EDITOR+ (el servidor decide).
 */
@Injectable({ providedIn: 'root' })
export class ResultsApi {
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

  // ===================== Objetivos (RF07) =====================
  objetivos = () => this.get<Objetivo[]>('/objetivos');
  objetivo = (id: string) => this.get<Objetivo>(`/objetivos/${id}`);
  createObjetivo = (data: ObjetivoInput) => this.post<Objetivo>('/objetivos', data);
  updateObjetivo = (id: string, data: Partial<ObjetivoInput>) => this.patch<Objetivo>(`/objetivos/${id}`, data);
  deleteObjetivo = (id: string) => this.delete<void>(`/objetivos/${id}`);

  // ===================== Tareas (RF08) =====================
  tareas = (filtro: TareaFiltro = {}) => {
    const params: Record<string, string> = {};
    if (filtro.estado) params['estado'] = filtro.estado;
    if (filtro.objetivoId) params['objetivoId'] = filtro.objetivoId;
    return this.get<Tarea[]>('/tareas', params);
  };
  tarea = (id: string) => this.get<TareaDetalle>(`/tareas/${id}`);
  createTarea = (data: TareaInput) => this.post<Tarea>('/tareas', data);
  updateTarea = (id: string, data: Partial<TareaInput>) => this.patch<Tarea>(`/tareas/${id}`, data);
  deleteTarea = (id: string) => this.delete<void>(`/tareas/${id}`);
  /** Cambia el estado OPERATIVO respetando las transiciones permitidas (COMPLETADA exige resultado ACEPTADO). */
  cambiarEstadoTarea = (id: string, data: CambioEstadoTareaInput) => this.post<Tarea>(`/tareas/${id}/estado`, data);
  /** Crea el contrato de resultado (RF29) de la tarea (relación 1-1). */
  crearContrato = (tareaId: string, data: ContratoInput) =>
    this.post<ContratoResultado>(`/tareas/${tareaId}/contrato`, data);
  agregarEvidenciaTarea = (tareaId: string, data: EvidenciaInput) =>
    this.post<Evidencia>(`/tareas/${tareaId}/evidencias`, data);
  incumplimientosTarea = (tareaId: string) => this.get<Incumplimiento[]>(`/tareas/${tareaId}/incumplimientos`);
  crearIncumplimiento = (tareaId: string, data: IncumplimientoInput) =>
    this.post<Incumplimiento>(`/tareas/${tareaId}/incumplimientos`, data);

  // ===================== Contratos de resultado (RF29/RF30/RF31) =====================
  contrato = (id: string) => this.get<ContratoResultado>(`/contratos/${id}`);
  /** Edición del contrato: solo mientras está PROPUESTO (un comprometido es inmutable). */
  actualizarContrato = (id: string, data: ContratoInput) => this.patch<ContratoResultado>(`/contratos/${id}`, data);
  /** Comprometer (PROPUESTO → COMPROMETIDO): fija el compromiso y lo hace inmutable. */
  comprometerContrato = (id: string) => this.post<ContratoResultado>(`/contratos/${id}/comprometer`);
  /** Avance del estado del resultado (EN_PRODUCCION / PENDIENTE_VALIDACION). */
  avanzarContrato = (id: string, estado: EstadoResultadoAvance) =>
    this.post<ContratoResultado>(`/contratos/${id}/avanzar`, { estado });
  /** Verificación (RF30): el servidor garantiza verificador ≠ ejecutor. Acepta o devuelve el resultado. */
  validarContrato = (id: string, data: ValidacionInput) => this.post<ResultadoValidacion>(`/contratos/${id}/validar`, data);
  /** Nueva versión de un contrato comprometido (inmutable, RF29). */
  nuevaVersionContrato = (id: string, data: ContratoInput) =>
    this.post<ContratoResultado>(`/contratos/${id}/versiones`, data);
  agregarEvidenciaContrato = (id: string, data: EvidenciaInput) =>
    this.post<Evidencia>(`/contratos/${id}/evidencias`, data);

  // ===================== Incumplimientos (RF31) =====================
  /** Registra un intento/ciclo de corrección; al agotar los límites, el incumplimiento se declara. */
  registrarIntento = (id: string, data: IntentoInput) => this.post<Incumplimiento>(`/incumplimientos/${id}/intento`, data);
}
