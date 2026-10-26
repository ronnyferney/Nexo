import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  ActualizarPublicacionInput,
  Comentario,
  CrearComentarioInput,
  CrearPublicacionInput,
  FeedFiltro,
  FeedPublicaciones,
  Publicacion,
  PublicacionDetalle,
  Reaccion,
  ReaccionTipo,
} from './community.models';

/**
 * Fachada tipada del muro de comunidad interna (E11). Espeja el contrato del backend (`modules/community`). Leer,
 * publicar, comentar y reaccionar es participación normal (VIEWER+); el servidor es el gate real. El autor lo fija
 * siempre el contexto autenticado, nunca el cuerpo. Todo filtra por `workspaceId` (multi-tenant). Editar o archivar
 * una publicación lo decide el servicio (autor o ADMIN+); el UI oculta las acciones que no corresponden.
 */
@Injectable({ providedIn: 'root' })
export class CommunityApi {
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

  /** Feed del muro, recientes primero. Sin filtro de estado oculta las ARCHIVADA. */
  publicaciones(filtro: FeedFiltro = {}) {
    const params: Record<string, string> = {};
    if (filtro.tipo) params['tipo'] = filtro.tipo;
    if (filtro.estado) params['estado'] = filtro.estado;
    if (filtro.orgUnitId) params['orgUnitId'] = filtro.orgUnitId;
    if (filtro.take !== undefined) params['take'] = String(filtro.take);
    if (filtro.skip !== undefined) params['skip'] = String(filtro.skip);
    return this.get<FeedPublicaciones>('/comunidad/publicaciones', params);
  }

  publicacion = (id: string) => this.get<PublicacionDetalle>(`/comunidad/publicaciones/${id}`);
  crearPublicacion = (data: CrearPublicacionInput) => this.post<Publicacion>('/comunidad/publicaciones', data);
  actualizarPublicacion = (id: string, data: ActualizarPublicacionInput) =>
    this.patch<Publicacion>(`/comunidad/publicaciones/${id}`, data);
  /** Baja lógica: el backend marca ARCHIVADA (conserva histórico, comentarios y reacciones). */
  archivarPublicacion = (id: string) => this.delete<Publicacion>(`/comunidad/publicaciones/${id}`);

  comentarios = (id: string) => this.get<Comentario[]>(`/comunidad/publicaciones/${id}/comentarios`);
  comentar = (id: string, data: CrearComentarioInput) =>
    this.post<Comentario>(`/comunidad/publicaciones/${id}/comentarios`, data);

  /** Reacción idempotente: repetir el POST devuelve la existente, no crea otra. */
  reaccionar = (id: string, tipo: ReaccionTipo) =>
    this.post<Reaccion>(`/comunidad/publicaciones/${id}/reacciones`, { tipo });
  /** Retira la reacción del usuario (idempotente: si no existía, no falla). */
  quitarReaccion = (id: string, tipo: ReaccionTipo) =>
    this.delete<{ ok: boolean }>(`/comunidad/publicaciones/${id}/reacciones/${tipo}`);
}
