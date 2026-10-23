import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { PlatformApi } from '../core/platform.api';
import { IconComponent } from '../shared/icon.component';

@Component({
  selector: 'nx-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="sidebar">
      <a class="brand" routerLink="/">
        <span class="logo">N</span>
        <span><strong>Nexo</strong><small>AI Agents Platform</small></span>
      </a>
      <nav aria-label="Navegación principal">
        <div class="nav-section" id="nav-portal">Portal</div>
        <div class="nav-group" role="group" aria-labelledby="nav-portal">
          @for (item of portalNav; track item.path) {
            <a [routerLink]="item.path" [class.active]="portalActive() === item.path" [attr.aria-current]="portalActive() === item.path ? 'page' : null">
              <nx-icon [name]="item.icon" />{{ item.label }}
            </a>
          }
        </div>
        @if (auth.isAdmin()) {
          <div class="nav-section admin" id="nav-admin">Administración</div>
          <div class="nav-group" role="group" aria-labelledby="nav-admin">
            @for (item of adminNav; track item.path) {
              <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: item.exact }">
                <nx-icon [name]="item.icon" />{{ item.label }}
              </a>
            }
          </div>
        }
        @if (platform.isPlatformAdmin()) {
          <div class="nav-section platform" id="nav-platform">Plataforma Nexo</div>
          <div class="nav-group" role="group" aria-labelledby="nav-platform">
            @for (item of platformNav; track item.path) {
              <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: item.exact }">
                <nx-icon [name]="item.icon" />{{ item.label }}
              </a>
            }
          </div>
        }
      </nav>
      <div class="spacer"></div>
      @if (auth.me(); as me) {
        @if (me.memberships.length > 1) {
          <select class="ws" [value]="me.activeWorkspaceId" (change)="switch($any($event.target).value)">
            @for (m of me.memberships; track m.workspace.id) {
              <option [value]="m.workspace.id">{{ m.workspace.name }}</option>
            }
          </select>
        }
        <div class="user">
          <div class="avatar">{{ me.name.charAt(0) }}</div>
          <div class="who"><strong>{{ me.name }}</strong><small>{{ workspaceName() }}</small></div>
          <button class="btn ghost icon" title="Cerrar sesión" (click)="auth.logout()"><nx-icon name="logout" /></button>
        </div>
      }
    </aside>
    <main><router-outlet /></main>
  `,
  styles: `
    :host { display: flex; min-height: 100vh; }
    .sidebar { width: 248px; background: var(--sidebar); color: #c9cce0; display: flex; flex-direction: column; padding: 18px 14px; position: sticky; top: 0; height: 100vh; flex-shrink: 0; }
    .brand { display: flex; gap: 10px; align-items: center; padding: 6px 8px 22px; color: #fff; }
    .brand small { display: block; font-size: 11px; color: #8a8fb0; }
    .logo { width: 34px; height: 34px; border-radius: 10px; background: linear-gradient(135deg, #6d6dfa, #9b5cf6); display: grid; place-items: center; font-weight: 800; color: #fff; }
    nav { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
    .nav-group { display: flex; flex-direction: column; gap: 2px; }
    .nav-section { font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #6f7499; padding: 4px 12px 6px; }
    .nav-section.admin, .nav-section.platform { margin-top: 18px; padding-top: 14px; border-top: 1px solid #23264a; }
    .nav-section.platform { color: #b49cf7; }
    nav a { display: flex; gap: 11px; align-items: center; padding: 9px 12px; border-radius: 9px; color: #b4b8d4; font-weight: 500; }
    nav a:hover { background: rgba(255, 255, 255, 0.05); color: #fff; }
    nav a.active { background: rgba(109, 109, 250, 0.18); color: #fff; }
    .spacer { flex: 1; }
    .ws { margin-bottom: 10px; background: #1d2040; color: #fff; border: 1px solid #2c3060; border-radius: 8px; padding: 7px; }
    .user { display: flex; align-items: center; gap: 10px; padding: 10px 6px 0; border-top: 1px solid #23264a; }
    .user .btn { color: #b4b8d4; }
    .avatar { width: 32px; height: 32px; border-radius: 50%; background: #2c2f5c; color: #fff; display: grid; place-items: center; font-weight: 700; text-transform: uppercase; }
    .who { flex: 1; min-width: 0; }
    .who strong { display: block; color: #fff; font-size: 13px; }
    .who small { display: block; color: #8a8fb0; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    main { flex: 1; min-width: 0; }
    @media (max-width: 900px) { :host { flex-direction: column; } .sidebar { width: 100%; height: auto; position: static; } nav { flex-direction: row; overflow-x: auto; align-items: center; } .nav-group { flex-direction: row; } .nav-section { padding: 0 8px; white-space: nowrap; } .nav-section.admin, .nav-section.platform { margin: 0 0 0 8px; padding: 0 8px; border-top: 0; border-left: 1px solid #23264a; } nav a { white-space: nowrap; } .spacer, .user, .ws { display: none; } }
  `,
})
export class ShellComponent implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly platform = inject(PlatformApi);
  private readonly router = inject(Router);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  /** Entrada activa del portal: la coincidencia más específica (así `/agents/explore` no activa también `/agents`). */
  protected readonly portalActive = computed(() => {
    const path = this.url().split(/[?#]/)[0];
    const matches = this.portalNav.filter((i) => (i.exact ? path === i.path : path === i.path || path.startsWith(`${i.path}/`)));
    return matches.sort((a, b) => b.path.length - a.path.length)[0]?.path ?? null;
  });
  protected readonly portalNav = [
    { path: '/', label: 'Inicio', icon: 'dashboard', exact: true },
    { path: '/agents', label: 'Agentes', icon: 'bot', exact: false },
    { path: '/agents/explore', label: 'Explorar agentes', icon: 'search', exact: false },
    { path: '/skills', label: 'Skills', icon: 'sparkles', exact: false },
    { path: '/knowledge', label: 'Conocimiento', icon: 'book', exact: false },
    { path: '/routines', label: 'Rutinas', icon: 'calendar', exact: false },
    { path: '/supervision', label: 'Supervisión', icon: 'inbox', exact: false },
    { path: '/workflows', label: 'Flujos', icon: 'flow', exact: false },
    { path: '/executions', label: 'Ejecuciones', icon: 'history', exact: false },
    { path: '/integrations', label: 'Integraciones', icon: 'puzzle', exact: false },
    { path: '/connectors', label: 'Conectores', icon: 'plug', exact: false },
    { path: '/my-usage', label: 'Mi consumo', icon: 'wallet', exact: false },
  ];
  protected readonly adminNav = [
    { path: '/admin', label: 'Costos', icon: 'chart', exact: true },
    { path: '/admin/providers', label: 'Proveedores IA', icon: 'cpu', exact: false },
    { path: '/admin/organization', label: 'Organización', icon: 'building', exact: false },
    { path: '/admin/budgets', label: 'Presupuestos', icon: 'wallet', exact: false },
    { path: '/admin/alerts', label: 'Alertas', icon: 'bell', exact: false },
    { path: '/admin/edges', label: 'Nexo Edge', icon: 'server', exact: false },
    { path: '/admin/security', label: 'Seguridad', icon: 'shield', exact: false },
    { path: '/admin/settings', label: 'Ajustes', icon: 'settings', exact: false },
  ];
  protected readonly platformNav = [
    { path: '/platform', label: 'Éxito de clientes', icon: 'trophy', exact: true },
    { path: '/platform/copilot-quality', label: 'Calidad del Copilot', icon: 'sparkles', exact: false },
  ];

  ngOnInit() {
    void this.auth.loadMe();
    void this.platform.loadMe();
  }

  workspaceName() {
    const me = this.auth.me();
    return me?.memberships.find((m) => m.workspace.id === me.activeWorkspaceId)?.workspace.name ?? '';
  }

  async switch(id: string) {
    await this.auth.switchWorkspace(id);
    location.reload();
  }
}
