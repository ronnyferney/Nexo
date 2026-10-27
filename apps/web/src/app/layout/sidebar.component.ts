import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { PlatformApi } from '../core/platform.api';
import { IconComponent } from '../shared/icon.component';
import { activeItemPath, filterGroups, NAV_GROUPS, normalize, visibleGroups } from './sidebar.util';

export type { NavGroup, NavItem } from './sidebar.util';

/** Clave de `localStorage` donde se recuerda si el menú está plegado a iconos (por visor). */
const RAIL_STORE_KEY = 'nexo.sidebar.rail';

function loadRail(): boolean {
  try {
    return localStorage.getItem(RAIL_STORE_KEY) === '1';
  } catch {
    return false;
  }
}
function saveRail(rail: boolean): void {
  try {
    localStorage.setItem(RAIL_STORE_KEY, rail ? '1' : '0');
  } catch {
    /* almacenamiento no disponible: no se recuerda, pero la UI sigue funcionando */
  }
}

/**
 * Menú lateral único y expandible (patrón de apps modernas tipo Fireflies), con los colores corporativos de NEXO:
 *  - Arriba: conmutador de usuario/workspace y botón de plegar/expandir.
 *  - Lista SEGMENTADA por secciones (con etiqueta sutil y divisores), operativas arriba.
 *  - Pie fijo: utilidades (Integraciones, Ajustes, Plataforma).
 *  - Plegable a solo iconos; el estado se recuerda por visor.
 *  - Menú de usuario (cuenta/workspace/salir) desde el conmutador superior.
 *
 * Presentación pura sobre el estado de sesión y la URL; la arquitectura de información vive en `sidebar.util.ts`.
 * No cambia rutas ni permisos.
 */
@Component({
  selector: 'nx-sidebar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    <aside class="sb" [class.rail]="rail()">
      <!-- Cabecera: conmutador de usuario + plegar -->
      <div class="top">
        @if (auth.me(); as me) {
          <button
            type="button"
            class="user-switch"
            aria-haspopup="menu"
            [attr.aria-expanded]="userOpen()"
            [attr.aria-label]="'Menú de usuario: ' + me.name"
            [title]="me.name"
            (click)="toggleUser()"
          >
            <span class="avatar">{{ me.name.charAt(0) }}</span>
            @if (!rail()) {
              <span class="who"><strong>{{ me.name }}</strong></span>
              <nx-icon class="chev" name="chevronDown" [size]="14" />
            }
          </button>
        } @else {
          <a class="brand" routerLink="/" aria-label="Nexo: ir al inicio" title="Nexo">
            <img class="insignia" src="brand/insignia.png" width="30" height="30" alt="" />
            @if (!rail()) { <strong>Nexo</strong> }
          </a>
        }
        <button
          type="button"
          class="collapse"
          [attr.aria-expanded]="!rail()"
          [attr.aria-label]="rail() ? 'Expandir el menú' : 'Plegar el menú'"
          [title]="rail() ? 'Expandir el menú' : 'Plegar el menú'"
          (click)="toggleRail()"
        >
          <nx-icon [name]="rail() ? 'arrowRight' : 'arrowLeft'" [size]="15" />
        </button>
      </div>

      @if (!rail()) {
        <div class="filter">
          <nx-icon name="search" [size]="15" aria-hidden="true" />
          <input
            type="search"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
            placeholder="Buscar en el menú…"
            aria-label="Buscar en el menú"
          />
          @if (query()) {
            <button type="button" class="clear" title="Limpiar búsqueda" aria-label="Limpiar búsqueda" (click)="query.set('')">
              <nx-icon name="x" [size]="14" />
            </button>
          }
        </div>
      }

      <!-- Secciones operativas -->
      <nav class="main" aria-label="Navegación principal">
        @for (group of mainGroups(); track group.id) {
          @if (!group.pinned && !rail() && !filtering()) {
            <p class="section">{{ group.label }}</p>
          }
          <div class="grp" role="group" [attr.aria-label]="group.label">
            @for (item of group.items; track item.path) {
              <a
                class="nav-link"
                [routerLink]="item.path"
                [class.active]="activeItem() === item.path"
                [attr.aria-current]="activeItem() === item.path ? 'page' : null"
                [title]="item.label"
              >
                <nx-icon [name]="item.icon" />@if (!rail()) { <span class="lbl">{{ item.label }}</span> }
              </a>
            }
          </div>
        } @empty {
          @if (footerGroups().length === 0) { <p class="empty">Sin resultados.</p> }
        }
      </nav>

      <div class="spacer"></div>

      <!-- Pie: utilidades (Integraciones, Ajustes, Plataforma) -->
      @if (footerGroups().length) {
        <nav class="footer-nav" aria-label="Utilidades">
          @for (group of footerGroups(); track group.id) {
            @for (item of group.items; track item.path) {
              <a
                class="nav-link"
                [routerLink]="item.path"
                [class.active]="activeItem() === item.path"
                [attr.aria-current]="activeItem() === item.path ? 'page' : null"
                [title]="item.label"
              >
                <nx-icon [name]="item.icon" />@if (!rail()) { <span class="lbl">{{ item.label }}</span> }
              </a>
            }
          }
        </nav>
      }

      <!-- Menú de usuario (cuenta / workspace / salir) -->
      @if (userOpen() && auth.me(); as me) {
        <div class="backdrop" (click)="closeUser()"></div>
        <div class="user-menu" role="menu" aria-label="Menú de usuario">
          <div class="u-head">
            <span class="avatar lg">{{ me.name.charAt(0) }}</span>
            <div class="u-who"><strong>{{ me.name }}</strong><small>{{ workspaceName() }}</small></div>
          </div>
          @if (me.memberships.length > 1) {
            <label class="u-ws">
              <span>Workspace</span>
              <select aria-label="Cambiar de workspace" [value]="me.activeWorkspaceId" (change)="switch($any($event.target).value)">
                @for (m of me.memberships; track m.workspace.id) {
                  <option [value]="m.workspace.id">{{ m.workspace.name }}</option>
                }
              </select>
            </label>
          }
          <a class="u-item" role="menuitem" routerLink="/account" (click)="closeUser()"><nx-icon name="settings" [size]="16" />Mi cuenta y ajustes</a>
          <button type="button" class="u-item" role="menuitem" aria-label="Cerrar sesión" (click)="auth.logout()"><nx-icon name="logout" [size]="16" />Cerrar sesión</button>
        </div>
      }
    </aside>
  `,
  styles: `
    :host { display: contents; }
    .sb { width: 248px; background: var(--brand-navy, #08102D); color: #c9d1ec; display: flex; flex-direction: column; padding: 12px 12px 14px; border-right: 1px solid rgba(255, 255, 255, 0.08); position: sticky; top: 0; height: 100vh; flex-shrink: 0; transition: width 0.16s ease; }
    .sb.rail { width: 68px; padding: 12px 10px 14px; }
    .sb::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(120% 40% at 0% 0%, rgba(18, 91, 234, 0.14), transparent 70%); }
    .sb > * { position: relative; z-index: 1; }
    .sb :focus-visible { outline-color: var(--brand-cyan, #16C7F4); }
    /* Cabecera */
    .top { display: flex; align-items: center; gap: 8px; padding: 2px 2px 12px; }
    .user-switch { flex: 1; display: flex; align-items: center; gap: 10px; min-width: 0; padding: 6px 8px; border: 0; border-radius: 10px; background: transparent; color: #fff; font: inherit; cursor: pointer; text-align: left; }
    .user-switch:hover { background: rgba(255, 255, 255, 0.06); }
    .brand { flex: 1; display: flex; align-items: center; gap: 10px; min-width: 0; color: #fff; padding: 2px 6px; }
    .brand strong { font-size: 16px; font-weight: 800; }
    .insignia { width: 30px; height: 30px; display: block; flex-shrink: 0; }
    .avatar { width: 30px; height: 30px; border-radius: 9px; background: #16307a; box-shadow: 0 0 0 2px rgba(22, 199, 244, 0.35); color: #fff; display: grid; place-items: center; font-weight: 700; text-transform: uppercase; font-size: 13px; flex-shrink: 0; }
    .who { flex: 1; min-width: 0; }
    .who strong { display: block; color: #fff; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .user-switch .chev { color: #8f98c2; flex-shrink: 0; }
    .collapse { flex-shrink: 0; display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 8px; background: rgba(255, 255, 255, 0.05); color: #a3acd3; cursor: pointer; }
    .collapse:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
    .sb.rail .top { flex-direction: column; gap: 10px; }
    .sb.rail .user-switch, .sb.rail .brand { flex: none; justify-content: center; padding: 4px; }
    /* Filtro */
    .filter { position: relative; display: flex; align-items: center; margin-bottom: 8px; }
    .filter nx-icon { position: absolute; left: 10px; color: #8f98c2; pointer-events: none; }
    .filter input { width: 100%; background: #0e1838; color: #fff; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 9px; padding: 8px 30px 8px 32px; font: inherit; font-size: 13px; }
    .filter input::placeholder { color: #8f98c2; }
    .filter input:focus-visible { border-color: var(--brand-cyan, #16C7F4); outline: none; }
    .filter .clear { position: absolute; right: 6px; display: grid; place-items: center; width: 22px; height: 22px; border: 0; border-radius: 6px; background: transparent; color: #a3acd3; cursor: pointer; }
    .filter .clear:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
    /* Secciones */
    .main { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; overflow-x: hidden; }
    .grp { display: flex; flex-direction: column; gap: 2px; }
    .section { margin: 12px 12px 4px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #6f78a2; }
    .section:first-of-type { margin-top: 2px; }
    a.nav-link { position: relative; display: flex; gap: 11px; align-items: center; padding: 9px 12px; border-radius: 9px; color: #c0c7e3; font-weight: 500; white-space: nowrap; }
    a.nav-link .lbl { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    a.nav-link:hover { background: rgba(255, 255, 255, 0.06); color: #fff; }
    a.nav-link.active { background: rgba(18, 91, 234, 0.28); color: #fff; box-shadow: inset 0 0 0 1px rgba(22, 199, 244, 0.18); }
    a.nav-link.active::before { content: ''; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 0 3px 3px 0; background: var(--brand-gradient, linear-gradient(135deg, #125BEA, #16C7F4, #8550E9)); }
    a.nav-link.active nx-icon { color: var(--brand-cyan, #16C7F4); }
    .sb.rail a.nav-link { justify-content: center; padding: 10px 0; }
    .empty { color: #8f98c2; font-size: 12.5px; padding: 8px 12px; }
    .spacer { flex: 1; min-height: 8px; }
    /* Pie */
    .footer-nav { display: flex; flex-direction: column; gap: 2px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
    /* Menú de usuario */
    .backdrop { position: fixed; inset: 0; z-index: 40; }
    .user-menu { position: fixed; left: 14px; top: 56px; z-index: 41; width: 250px; background: #0e1838; color: #c9d1ec; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 12px; padding: 10px; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5); display: flex; flex-direction: column; gap: 4px; }
    .u-head { display: flex; gap: 10px; align-items: center; padding: 6px 8px 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); margin-bottom: 4px; }
    .avatar.lg { width: 38px; height: 38px; font-size: 15px; border-radius: 50%; }
    .u-who { min-width: 0; }
    .u-who strong { display: block; color: #fff; font-size: 13.5px; }
    .u-who small { display: block; color: #a3acd3; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .u-ws { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px 8px; }
    .u-ws span { font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #8f98c2; }
    .u-ws select { background: #111c45; color: #fff; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; padding: 7px; }
    .u-item { display: flex; gap: 10px; align-items: center; padding: 9px 10px; border: 0; border-radius: 8px; background: transparent; color: #c0c7e3; font: inherit; font-size: 13px; text-align: left; cursor: pointer; width: 100%; }
    .u-item:hover { background: rgba(255, 255, 255, 0.07); color: #fff; }
    @media (max-width: 900px) {
      .sb, .sb.rail { width: 100%; height: auto; position: relative; border-right: 0; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
      .sb.rail .top { flex-direction: row; }
      .sb.rail a.nav-link { justify-content: flex-start; padding: 9px 12px; }
      .main { max-height: 50vh; }
      .user-menu { left: 12px; right: 12px; width: auto; }
    }
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
  protected readonly query = signal('');
  protected readonly rail = signal<boolean>(loadRail());
  protected readonly userOpen = signal(false);

  /** Grupos visibles según el rol. */
  private readonly visible = computed(() =>
    visibleGroups(NAV_GROUPS, { isAdmin: this.auth.isAdmin(), isPlatformAdmin: !!this.platform.isPlatformAdmin() }),
  );
  protected readonly activeItem = computed(() => activeItemPath(this.visible(), this.url()));
  protected readonly filtering = computed(() => normalize(this.query()) !== '');
  /** Secciones operativas (no de pie), filtradas por la búsqueda. */
  protected readonly mainGroups = computed(() =>
    filterGroups(this.visible().filter((g) => !g.footer), this.query()),
  );
  /** Secciones de pie (utilidades), filtradas por la búsqueda. */
  protected readonly footerGroups = computed(() =>
    filterGroups(this.visible().filter((g) => g.footer), this.query()),
  );

  protected toggleRail(): void {
    const next = !this.rail();
    this.rail.set(next);
    if (next) this.query.set('');
    saveRail(next);
  }
  protected toggleUser(): void {
    this.userOpen.update((v) => !v);
  }
  protected closeUser(): void {
    this.userOpen.set(false);
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
