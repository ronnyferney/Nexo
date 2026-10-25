import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { PlatformApi } from '../core/platform.api';
import { IconComponent } from '../shared/icon.component';

/** Un ítem de navegación de la barra lateral. */
export interface NavItem {
  path: string;
  label: string;
  icon: string;
  /** Si es `true`, el ítem solo se marca activo con coincidencia exacta de ruta. */
  exact: boolean;
}

/**
 * Barra lateral (Sidebar) del «chrome» de la aplicación: marca, navegación por secciones
 * (Portal, Administración, Plataforma según el rol), selector de workspace y menú de usuario.
 *
 * Es presentación pura sobre el estado de sesión (`AuthService`/`PlatformApi`): no define rutas
 * ni modifica la lógica de navegación, solo refleja la URL actual para marcar el ítem activo.
 *
 * Uso: `<nx-sidebar />` dentro del shell. El `:host` usa `display: contents` para que el
 * `<aside>` sea el hijo flex directo del shell y la maqueta no cambie respecto a la versión previa.
 */
@Component({
  selector: 'nx-sidebar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, IconComponent],
  template: `
    <aside class="sidebar">
      <a class="brand" routerLink="/" aria-label="Nexo: ir al inicio">
        <img class="insignia" src="brand/insignia.png" width="38" height="38" alt="" />
        <span class="wordmark" aria-hidden="true"><strong>Nexo</strong><small lang="en">AI Agents Platform</small></span>
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
          <select class="ws" aria-label="Cambiar de workspace" [value]="me.activeWorkspaceId" (change)="switch($any($event.target).value)">
            @for (m of me.memberships; track m.workspace.id) {
              <option [value]="m.workspace.id">{{ m.workspace.name }}</option>
            }
          </select>
        }
        <div class="user">
          <div class="avatar">{{ me.name.charAt(0) }}</div>
          <div class="who"><strong>{{ me.name }}</strong><small>{{ workspaceName() }}</small></div>
          <a class="btn ghost icon" routerLink="/account" title="Mi cuenta" aria-label="Mi cuenta"><nx-icon name="settings" /></a>
          <button class="btn ghost icon" title="Cerrar sesión" aria-label="Cerrar sesión" (click)="auth.logout()"><nx-icon name="logout" /></button>
        </div>
      }
    </aside>
  `,
  styles: `
    :host { display: contents; }
    /* Kit de Marca: sidebar en azul profundo; las variables --brand-* se definen en styles.scss (con respaldo). */
    .sidebar { width: 248px; background: var(--brand-navy, #08102D); color: #c9d1ec; display: flex; flex-direction: column; padding: 18px 14px; border-right: 1px solid rgba(255, 255, 255, 0.08); position: sticky; top: 0; height: 100vh; flex-shrink: 0; }
    .sidebar::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(120% 40% at 0% 0%, rgba(18, 91, 234, 0.14), transparent 70%); }
    .sidebar > * { position: relative; z-index: 1; }
    .sidebar :focus-visible { outline-color: var(--brand-cyan, #16C7F4); }
    .brand { display: flex; gap: 10px; align-items: center; padding: 6px 8px 22px; color: #fff; border-radius: 10px; }
    .insignia { width: 38px; height: 38px; flex-shrink: 0; display: block; }
    /* Lockup de marca: «Nexo» en Inter 800 y descriptor en tipo oración (#a9b1d6 sobre azul profundo ≈ 8,8:1). */
    .wordmark { display: flex; flex-direction: column; gap: 1px; }
    .wordmark strong { display: block; font-size: 17px; font-weight: 800; line-height: 1.1; color: #fff; }
    .wordmark small { display: block; font-size: 11.5px; font-weight: 400; line-height: 1.2; color: #a9b1d6; }
    nav { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
    .nav-group { display: flex; flex-direction: column; gap: 2px; }
    .nav-section { font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #8f98c2; padding: 4px 12px 6px; }
    .nav-section.admin, .nav-section.platform { margin-top: 18px; padding-top: 14px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
    .nav-section.platform { color: #b9a3f5; }
    nav a { position: relative; display: flex; gap: 11px; align-items: center; padding: 9px 12px; border-radius: 9px; color: #c0c7e3; font-weight: 500; }
    nav a:hover { background: rgba(255, 255, 255, 0.06); color: #fff; }
    /* Activo: fondo azul eléctrico translúcido (texto blanco > 12:1) e indicador cian (> 3:1 sobre el azul profundo). */
    nav a.active { background: rgba(18, 91, 234, 0.28); color: #fff; box-shadow: inset 0 0 0 1px rgba(22, 199, 244, 0.18); }
    nav a.active::before { content: ''; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 0 3px 3px 0; background: var(--brand-gradient, linear-gradient(135deg, #125BEA, #16C7F4, #8550E9)); }
    nav a.active nx-icon { color: var(--brand-cyan, #16C7F4); }
    .spacer { flex: 1; }
    .ws { margin-bottom: 10px; background: #111c45; color: #fff; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; padding: 7px; }
    .user { display: flex; align-items: center; gap: 10px; padding: 10px 6px 0; border-top: 1px solid rgba(255, 255, 255, 0.08); }
    .user .btn { color: #c0c7e3; }
    .avatar { width: 32px; height: 32px; border-radius: 50%; background: #16307a; box-shadow: 0 0 0 2px rgba(22, 199, 244, 0.35); color: #fff; display: grid; place-items: center; font-weight: 700; text-transform: uppercase; }
    .who { flex: 1; min-width: 0; }
    .who strong { display: block; color: #fff; font-size: 13px; }
    .who small { display: block; color: #a3acd3; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    @media (max-width: 900px) { .sidebar { width: 100%; height: auto; position: relative; border-right: 0; border-bottom: 1px solid rgba(255, 255, 255, 0.08); } .brand { padding-bottom: 12px; } nav { flex-direction: row; overflow-x: auto; align-items: center; } .nav-group { flex-direction: row; } .nav-section { padding: 0 8px; white-space: nowrap; } .nav-section.admin, .nav-section.platform { margin: 0 0 0 8px; padding: 0 8px; border-top: 0; border-left: 1px solid rgba(255, 255, 255, 0.08); } nav a { white-space: nowrap; } nav a.active::before { left: 8px; right: 8px; top: auto; bottom: 0; width: auto; height: 3px; border-radius: 3px 3px 0 0; } .spacer, .user, .ws { display: none; } }
  `,
})
export class SidebarComponent {
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
  protected readonly portalNav: NavItem[] = [
    { path: '/', label: 'Inicio', icon: 'dashboard', exact: true },
    { path: '/agents', label: 'Agentes', icon: 'bot', exact: false },
    { path: '/agents/explore', label: 'Explorar agentes', icon: 'search', exact: false },
    { path: '/skills', label: 'Skills', icon: 'sparkles', exact: false },
    { path: '/knowledge', label: 'Conocimiento', icon: 'book', exact: false },
    { path: '/routines', label: 'Rutinas', icon: 'calendar', exact: false },
    { path: '/supervision', label: 'Supervisión', icon: 'inbox', exact: false },
    { path: '/workflows', label: 'Flujos', icon: 'flow', exact: false },
    { path: '/executions', label: 'Ejecuciones', icon: 'history', exact: false },
    { path: '/integrations', label: 'Apps conectadas', icon: 'puzzle', exact: false },
    { path: '/connectors', label: 'Conectores', icon: 'plug', exact: false },
    { path: '/my-usage', label: 'Mi consumo', icon: 'wallet', exact: false },
  ];
  protected readonly adminNav: NavItem[] = [
    { path: '/admin', label: 'Costos', icon: 'chart', exact: true },
    { path: '/admin/providers', label: 'IA conectada', icon: 'cpu', exact: false },
    { path: '/admin/organization', label: 'Organización', icon: 'building', exact: false },
    { path: '/admin/groups', label: 'Grupos', icon: 'users', exact: false },
    { path: '/admin/budgets', label: 'Presupuestos', icon: 'wallet', exact: false },
    { path: '/admin/alerts', label: 'Alertas', icon: 'bell', exact: false },
    { path: '/admin/edges', label: 'Nexo Edge', icon: 'server', exact: false },
    { path: '/admin/security', label: 'Seguridad', icon: 'shield', exact: false },
    { path: '/admin/settings', label: 'Ajustes', icon: 'settings', exact: false },
  ];
  protected readonly platformNav: NavItem[] = [
    { path: '/platform', label: 'Éxito de clientes', icon: 'trophy', exact: true },
    { path: '/platform/copilot-quality', label: 'Calidad del Copilot', icon: 'sparkles', exact: false },
    { path: '/platform/oauth-apps', label: 'Apps de inicio de sesión', icon: 'plug', exact: false },
  ];

  workspaceName() {
    const me = this.auth.me();
    return me?.memberships.find((m) => m.workspace.id === me.activeWorkspaceId)?.workspace.name ?? '';
  }

  async switch(id: string) {
    await this.auth.switchWorkspace(id);
    location.reload();
  }
}
