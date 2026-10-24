import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type { AuthConfig, InvitationAccepted, InvitationPreview, Me, Session } from './models';

const STORAGE_KEY = 'nexo.session';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly session = signal<Session | null>(this.restore());
  readonly me = signal<Me | null>(null);
  readonly isAuthenticated = computed(() => !!this.session());
  readonly canEdit = computed(() => this.session()?.role !== 'VIEWER');
  readonly isAdmin = computed(() => {
    const role = this.session()?.role;
    return role === 'ADMIN' || role === 'OWNER';
  });

  get token(): string | null {
    return this.session()?.accessToken ?? null;
  }

  async login(email: string, password: string): Promise<void> {
    this.store(await firstValueFrom(this.http.post<Session>(`${environment.apiUrl}/auth/login`, { email, password })));
  }

  async register(data: { email: string; name: string; password: string; workspaceName?: string }): Promise<void> {
    this.store(await firstValueFrom(this.http.post<Session>(`${environment.apiUrl}/auth/register`, data)));
  }

  /** Modo de registro (la web oculta «Crear cuenta» con `invite_only`) y si hay correo saliente. */
  config(): Promise<AuthConfig> {
    return firstValueFrom(this.http.get<AuthConfig>(`${environment.apiUrl}/auth/config`));
  }

  invitation(token: string): Promise<InvitationPreview> {
    return firstValueFrom(
      this.http.get<InvitationPreview>(`${environment.apiUrl}/auth/invitations/${encodeURIComponent(token)}`),
    );
  }

  /** Acepta una invitación y deja iniciada la sesión en el workspace que invitó. */
  async acceptInvitation(token: string, body: { name?: string; password?: string }): Promise<InvitationAccepted> {
    const res = await firstValueFrom(
      this.http.post<InvitationAccepted>(
        `${environment.apiUrl}/auth/invitations/${encodeURIComponent(token)}/accept`,
        body,
      ),
    );
    this.store({ accessToken: res.accessToken, workspaceId: res.workspaceId, role: res.role });
    await this.loadMe();
    return res;
  }

  /** Reemplaza el token vigente (p. ej. tras cambiar la contraseña, que invalida los anteriores). */
  adopt(session: Session): void {
    this.store({ accessToken: session.accessToken, workspaceId: session.workspaceId, role: session.role });
  }

  async loadMe(): Promise<void> {
    if (!this.session()) return;
    this.me.set(await firstValueFrom(this.http.get<Me>(`${environment.apiUrl}/auth/me`)));
  }

  async switchWorkspace(workspaceId: string): Promise<void> {
    this.store(await firstValueFrom(this.http.post<Session>(`${environment.apiUrl}/auth/switch-workspace`, { workspaceId })));
    await this.loadMe();
  }

  logout(returnUrl?: string): void {
    localStorage.removeItem(STORAGE_KEY);
    this.session.set(null);
    this.me.set(null);
    void this.router.navigate(['/login'], returnUrl ? { queryParams: { returnUrl } } : {});
  }

  private store(session: Session): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    this.session.set(session);
  }

  private restore(): Session | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw) as Session;
      const payload = JSON.parse(atob(session.accessToken.split('.')[1])) as { exp?: number };
      return payload.exp && payload.exp * 1000 < Date.now() ? null : session;
    } catch {
      return null;
    }
  }
}
