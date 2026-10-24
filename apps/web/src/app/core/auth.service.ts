import { HttpClient, HttpXsrfTokenExtractor } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  AuthConfig,
  InvitationAccepted,
  InvitationPreview,
  Me,
  PasswordResetResult,
  Role,
  Session,
} from './models';

/** Clave donde versiones anteriores guardaban el JWT; se borra al arrancar (M6). */
const LEGACY_STORAGE_KEY = 'nexo.session';
/** Cabecera del doble envío CSRF; su valor es la cookie `nexo_csrf` que emite la API. */
export const CSRF_HEADER = 'X-CSRF-Token';
export const CSRF_COOKIE = 'nexo_csrf';

/**
 * Sesión de la web (M6): el JWT viaja en la cookie HttpOnly `nexo_session`, que este código no puede leer. El estado
 * de la sesión sale de `GET /auth/me`; las peticiones que modifican datos repiten la cookie `nexo_csrf` en
 * `X-CSRF-Token` (lo hace `HttpClient` con `withXsrfConfiguration`, y `csrfHeaders()` para los `fetch` de SSE).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly xsrf = inject(HttpXsrfTokenExtractor);

  readonly me = signal<Me | null>(null);
  /** Workspace activo y rol en él, derivados de `GET /auth/me`. */
  readonly session = computed<Session | null>(() => {
    const me = this.me();
    if (!me) return null;
    const membership = me.memberships.find((m) => m.workspace.id === me.activeWorkspaceId);
    return { workspaceId: me.activeWorkspaceId, role: (membership?.role ?? 'VIEWER') as Role };
  });
  readonly isAuthenticated = computed(() => !!this.me());
  readonly canEdit = computed(() => this.session()?.role !== 'VIEWER');
  readonly isAdmin = computed(() => {
    const role = this.session()?.role;
    return role === 'ADMIN' || role === 'OWNER';
  });

  /** Al arrancar: olvida el token heredado de `localStorage` y pregunta a la API si hay sesión (cookie). */
  async init(): Promise<void> {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // almacenamiento no disponible (modo privado estricto): no hay nada que borrar
    }
    await this.loadMe().catch(() => this.me.set(null));
  }

  /** Cabeceras para `fetch` (SSE): `HttpClient` las añade solo; `fetch` no. */
  csrfHeaders(): Record<string, string> {
    const token = this.xsrf.getToken();
    return token ? { [CSRF_HEADER]: token } : {};
  }

  async login(email: string, password: string): Promise<void> {
    await firstValueFrom(this.http.post<unknown>(`${environment.apiUrl}/auth/login`, { email, password }));
    await this.loadMe();
  }

  /**
   * Registro (B4): la API responde lo mismo exista o no el correo y no inicia sesión; se inicia a continuación con la
   * contraseña elegida. Si no entra, el correo ya tenía otra cuenta (o la contraseña no es la suya).
   */
  async register(data: { email: string; name: string; password: string; workspaceName?: string }): Promise<void> {
    await firstValueFrom(this.http.post<unknown>(`${environment.apiUrl}/auth/register`, data));
    try {
      await this.login(data.email, data.password);
    } catch {
      throw new Error(
        'No pudimos iniciar sesión con esos datos. Si ya tenía una cuenta con este correo, inicie sesión con su ' +
          'contraseña habitual o pida una invitación al administrador de su empresa.',
      );
    }
  }

  /** Modo de registro (la web oculta «Crear cuenta» con `invite_only`) y si hay correo saliente. */
  config(): Promise<AuthConfig> {
    return firstValueFrom(this.http.get<AuthConfig>(`${environment.apiUrl}/auth/config`));
  }

  /** Pide el enlace de recuperación. La respuesta es la misma exista o no la cuenta; sin SMTP, la API responde 503. */
  forgotPassword(email: string): Promise<{ accepted: true; message: string }> {
    return firstValueFrom(
      this.http.post<{ accepted: true; message: string }>(`${environment.apiUrl}/auth/password/forgot`, { email }),
    );
  }

  /** Fija la contraseña nueva con el token del enlace. Cierra todas las sesiones: también la de este navegador. */
  async resetPassword(token: string, password: string): Promise<PasswordResetResult> {
    const res = await firstValueFrom(
      this.http.post<PasswordResetResult>(`${environment.apiUrl}/auth/password/reset`, { token, password }),
    );
    this.me.set(null);
    return res;
  }

  invitation(token: string): Promise<InvitationPreview> {
    return firstValueFrom(
      this.http.get<InvitationPreview>(`${environment.apiUrl}/auth/invitations/${encodeURIComponent(token)}`),
    );
  }

  /** Acepta una invitación y deja iniciada la sesión (cookie) en el workspace que invitó. */
  async acceptInvitation(token: string, body: { name?: string; password?: string }): Promise<InvitationAccepted> {
    const res = await firstValueFrom(
      this.http.post<InvitationAccepted>(
        `${environment.apiUrl}/auth/invitations/${encodeURIComponent(token)}/accept`,
        body,
      ),
    );
    await this.loadMe();
    return res;
  }

  async loadMe(): Promise<void> {
    this.me.set(await firstValueFrom(this.http.get<Me>(`${environment.apiUrl}/auth/me`)));
  }

  /** La API renueva la cookie con la sesión del otro workspace. */
  async switchWorkspace(workspaceId: string): Promise<void> {
    await firstValueFrom(this.http.post<unknown>(`${environment.apiUrl}/auth/switch-workspace`, { workspaceId }));
    await this.loadMe();
  }

  /**
   * Cierra la sesión en la API (revoca el token y borra las cookies) y vuelve al inicio de sesión. Espera la respuesta:
   * si llegara después de un nuevo inicio de sesión, borraría la cookie nueva.
   */
  async logout(returnUrl?: string): Promise<void> {
    await firstValueFrom(this.http.post<unknown>(`${environment.apiUrl}/auth/logout`, {})).catch(() => undefined);
    this.expire(returnUrl);
  }

  /** La API rechazó la sesión (401): se olvida localmente; la API ya borró la cookie inválida. */
  expire(returnUrl?: string): void {
    this.me.set(null);
    void this.router.navigate(['/login'], returnUrl ? { queryParams: { returnUrl } } : {});
  }
}
