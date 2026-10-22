import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type { Me, Session } from './models';

const STORAGE_KEY = 'nexo.session';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly session = signal<Session | null>(this.restore());
  readonly me = signal<Me | null>(null);
  readonly isAuthenticated = computed(() => !!this.session());
  readonly canEdit = computed(() => this.session()?.role !== 'VIEWER');

  get token(): string | null {
    return this.session()?.accessToken ?? null;
  }

  async login(email: string, password: string): Promise<void> {
    this.store(await firstValueFrom(this.http.post<Session>(`${environment.apiUrl}/auth/login`, { email, password })));
  }

  async register(data: { email: string; name: string; password: string; workspaceName?: string }): Promise<void> {
    this.store(await firstValueFrom(this.http.post<Session>(`${environment.apiUrl}/auth/register`, data)));
  }

  async loadMe(): Promise<void> {
    if (!this.session()) return;
    this.me.set(await firstValueFrom(this.http.get<Me>(`${environment.apiUrl}/auth/me`)));
  }

  async switchWorkspace(workspaceId: string): Promise<void> {
    this.store(await firstValueFrom(this.http.post<Session>(`${environment.apiUrl}/auth/switch-workspace`, { workspaceId })));
    await this.loadMe();
  }

  logout(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.session.set(null);
    this.me.set(null);
    void this.router.navigate(['/login']);
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
