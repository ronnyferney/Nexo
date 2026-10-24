import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  DetectResult,
  DevicePollResult,
  DeviceStartResult,
  OAuthStartInput,
  ProviderConnectInput,
  ProviderConnectResult,
  ProviderView,
} from './llm-providers.models';

/** Fachada tipada de la galería de proveedores de IA (`/admin/llm/providers`, solo ADMIN+). */
@Injectable({ providedIn: 'root' })
export class LlmProvidersApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/admin/llm/providers`;

  providers = () => firstValueFrom(this.http.get<{ providers: ProviderView[] }>(this.base));
  connect = (id: string, data: ProviderConnectInput) =>
    firstValueFrom(this.http.post<ProviderConnectResult>(`${this.base}/${encodeURIComponent(id)}/connect`, data));
  discover = (id: string, connectionId: string) =>
    firstValueFrom(
      this.http.get<{ models: string[] }>(`${this.base}/${encodeURIComponent(id)}/discover`, { params: { connectionId } }),
    );
  /** Inicio del flujo OAuth: la web abre `authorizeUrl` en una ventana emergente (o redirige si se bloquea). */
  oauthStart = (id: string, data: OAuthStartInput = {}) =>
    firstValueFrom(this.http.post<{ authorizeUrl: string }>(`${this.url(id)}/oauth/start`, data));
  /** Flujo de código de dispositivo (RFC 8628, p. ej. Hugging Face). */
  deviceStart = (id: string, data: OAuthStartInput = {}) =>
    firstValueFrom(this.http.post<DeviceStartResult>(`${this.url(id)}/device/start`, data));
  devicePoll = (id: string, flowId: string) =>
    firstValueFrom(this.http.post<DevicePollResult>(`${this.url(id)}/device/poll`, { flowId }));
  /** Detección de un servidor local (Ollama, LM Studio) y de sus modelos instalados. */
  detect = (id: string, baseUrl?: string) =>
    firstValueFrom(this.http.post<DetectResult>(`${this.url(id)}/detect`, baseUrl ? { baseUrl } : {}));

  private url(id: string) {
    return `${this.base}/${encodeURIComponent(id)}`;
  }
}
