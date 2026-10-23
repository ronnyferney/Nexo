import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type { ProviderConnectInput, ProviderConnectResult, ProviderView } from './llm-providers.models';

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
  /** Inicio del flujo OAuth (hoy solo `openrouter`): el navegador se redirige a `authorizeUrl`. */
  oauthStart = (id: string) =>
    firstValueFrom(this.http.post<{ authorizeUrl: string }>(`${this.base}/${encodeURIComponent(id)}/oauth/start`, {}));
}
