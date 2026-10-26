import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type { Canal, ConvertirEnTareaInput, CrearCanalInput, CrearHiloInput, HiloCanal } from './collaboration.models';
import type { Tarea } from './results.models';

/**
 * Fachada tipada de la coordinación transversal (E5 · RF36): canales por misión/proceso/área y sus hilos. Espeja el
 * contrato del backend (`modules/collaboration`). Convertir una solicitud en tarea autorizada exige EDITOR+ (el
 * servidor es el gate real): mencionar no asigna trabajo ni concede acceso (QA12). Todo filtra por `workspaceId`.
 */
@Injectable({ providedIn: 'root' })
export class CollaborationApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  private get<T>(path: string) {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`));
  }
  private post<T>(path: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(`${this.base}${path}`, body));
  }

  canales = () => this.get<Canal[]>('/canales');
  canal = (id: string) => this.get<Canal>(`/canales/${id}`);
  crearCanal = (data: CrearCanalInput) => this.post<Canal>('/canales', data);

  hilos = (canalId: string) => this.get<HiloCanal[]>(`/canales/${canalId}/hilos`);
  crearHilo = (canalId: string, data: CrearHiloInput) =>
    this.post<HiloCanal>(`/canales/${canalId}/hilos`, data);
  /** Registra un intercambio en el hilo; al superar el umbral el servidor detiene y pide escalar (RF36). */
  registrarIntercambio = (hiloId: string) => this.post<HiloCanal>(`/hilos/${hiloId}/intercambio`);
  /** Convierte una solicitud del hilo en TAREA autorizada (idempotente: devuelve la existente si ya se convirtió). */
  convertirEnTarea = (hiloId: string, data: ConvertirEnTareaInput) =>
    this.post<Tarea>(`/hilos/${hiloId}/convertir-en-tarea`, data);
}
