import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { type DateRange, lastDays } from '../shared/date-range.component';
import type { CopilotFeedbackItem, CopilotMetrics, PlatformMe, PlatformOAuthProvider } from './platform.models';

/** Fachada de la consola de plataforma Nexo (ADR 0006 D6). Solo administradores de Nexo. */
@Injectable({ providedIn: 'root' })
export class PlatformApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly base = environment.apiUrl;
  private pending: Promise<boolean> | null = null;
  /** Sesión para la que se resolvió `pending`; si cambia (otro usuario o workspace) se vuelve a consultar. */
  private pendingFor: unknown = null;

  /** `null` mientras no se ha consultado; luego indica si el usuario es administrador de plataforma. */
  readonly isPlatformAdmin = signal<boolean | null>(null);
  /** Rango de fechas compartido por las pestañas de la consola (se conserva al navegar entre ellas). */
  readonly range = signal<DateRange>(lastDays(30));

  /** Apps OAuth de la plataforma («Iniciar sesión con…») — solo administradores de plataforma. */
  oauthApps = () => firstValueFrom(this.http.get<PlatformOAuthProvider[]>(`${this.base}/platform/oauth-apps`));
  saveOAuthApp = (provider: string, clientId: string, clientSecret: string) =>
    firstValueFrom(
      this.http.put<{ provider: string; clientIdHint: string }>(`${this.base}/platform/oauth-apps/${provider}`, { clientId, clientSecret }),
    );
  removeOAuthApp = (provider: string) =>
    firstValueFrom(this.http.delete(`${this.base}/platform/oauth-apps/${provider}`));

  /** Consulta `GET /platform/me` una sola vez por sesión; ante error se asume que no es administrador. */
  loadMe(force = false): Promise<boolean> {
    const session = this.auth.session();
    if (!session) {
      this.reset();
      return Promise.resolve(false);
    }
    if (force || this.pendingFor !== session) {
      this.pending = null;
      this.pendingFor = session;
      this.isPlatformAdmin.set(null);
    }
    this.pending ??= firstValueFrom(this.http.get<PlatformMe>(`${this.base}/platform/me`))
      .then((me) => !!me?.isPlatformAdmin)
      .catch(() => false)
      .then((isAdmin) => {
        this.isPlatformAdmin.set(isAdmin);
        return isAdmin;
      });
    return this.pending;
  }

  /** Olvida el resultado (cierre de sesión o cambio de usuario). */
  reset(): void {
    this.pending = null;
    this.pendingFor = null;
    this.isPlatformAdmin.set(null);
  }

  metrics = (from: string, to: string) =>
    firstValueFrom(this.http.get<CopilotMetrics>(`${this.base}/platform/copilot/metrics`, { params: { from, to } }));

  async feedback(): Promise<CopilotFeedbackItem[]> {
    const raw = await firstValueFrom(this.http.get<unknown>(`${this.base}/platform/copilot/feedback`));
    if (Array.isArray(raw)) return raw as CopilotFeedbackItem[];
    return ((raw as { items?: CopilotFeedbackItem[] } | null)?.items ?? []) as CopilotFeedbackItem[];
  }
}
