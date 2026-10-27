import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { PlatformApi } from '../core/platform.api';
import { IconComponent } from '../shared/icon.component';
import {
  activeGroupId,
  activeItemPath,
  filterGroups,
  NAV_GROUPS,
  normalize,
  visibleGroups,
  type NavGroup,
} from './sidebar.util';

export type { NavGroup, NavItem } from './sidebar.util';

/** Clave de `localStorage` donde se recuerda si el panel secundario está oculto (por visor). */
const PANEL_STORE_KEY = 'nexo.sidebar.panelHidden';

function loadPanelHidden(): boolean {
  try {
    return localStorage.getItem(PANEL_STORE_KEY) === '1';
  } catch {
    return false;
  }
}

function savePanelHidden(hidden: boolean): void {
  try {
    localStorage.setItem(PANEL_STORE_KEY, hidden ? '1' : '0');
  } catch {
    // almacenamiento no disponible (modo privado estricto): no se recuerda, pero la UI sigue funcionando
  }
}

/**
 * Navegación lateral de DOS NIVELES (patrón de apps modernas tipo Fireflies), con los colores corporativos de NEXO:
 *  - **Riel** angosto de iconos: una entrada por ÁREA (grupo de navegación), más el menú de usuario abajo.
 *  - **Panel secundario contextual**: muestra los ítems del área activa (o los resultados de búsqueda), con su título.
 *    Se puede ocultar para ganar espacio (recordado por visor).
 *  - **Menú de usuario** (la "tuerca"/cuenta): desplegable con cuenta, cambio de workspace y cierre de sesión.
 *
 * Presentación pura sobre el estado de sesión (`AuthService`/`PlatformApi`) y la URL actual; la arquitectura de
 * información (grupos, filtrado, ítem/área activa) vive en `sidebar.util.ts`. No cambia rutas ni permisos.
 */
@Component({
  selector: 'nx-sidebar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    <aside class="nav" [class.panel-hidden]="panelHidden()">
      <!-- Nivel 1: riel de iconos (áreas) -->
      <div class="rail">
        <a class="brand-ico" routerLink="/" aria-label="Nexo: ir al inicio" title="Nexo">
          <img class="insignia" src="brand/insignia.png" width="30" height="30" alt="" />
        </a>
        <button
          type="button"
          class="rail-toggle"
          [attr.aria-label]="panelHidden() ? 'Mostrar el panel' : 'Ocultar el panel'"
          [title]="panelHidden() ? 'Mostrar el panel' : 'Ocultar el panel'"
          (click)="togglePanel()"
        >
          <nx-icon [name]="panelHidden() ? 'arrowRight' : 'arrowLeft'" [size]="15" />
        </button>
        <nav class="rail-areas" aria-label="Áreas">
          @for (g of areas(); track g.id) {
            <button
              type="button"
              class="rail-ico area"
              [class.active]="displayGroupId() === g.id"
              [attr.aria-label]="g.label"
              [attr.aria-current]="displayGroupId() === g.id ? 'true' : null"
              [title]="g.label"
              (click)="openArea(g)"
            >
              <nx-icon [name]="g.icon" [size]="19" />
            </button>
          }
        </nav>
        <div class="rail-foot">
          @if (auth.me(); as me) {
            <button
              type="button"
              class="rail-ico avatar-btn"
              aria-haspopup="menu"
              [attr.aria-expanded]="userOpen()"
              aria-label="Menú de usuario"
              title="Cuenta y ajustes"
              (click)="toggleUser()"
            >
              <span class="avatar">{{ me.name.charAt(0) }}</span>
            </button>
          }
        </div>
      </div>

      <!-- Nivel 2: panel secundario contextual -->
      @if (!panelHidden()) {
        <div class="panel">
          <header class="panel-head">
            <strong>{{ areaLabel() }}</strong>
          </header>
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
          <nav class="panel-items" aria-label="Navegación principal">
            @for (item of panelItems(); track item.path) {
              <a
                class="nav-link"
                [routerLink]="item.path"
                [class.active]="activeItem() === item.path"
                [attr.aria-current]="activeItem() === item.path ? 'page' : null"
                [title]="item.label"
              >
                <nx-icon [name]="item.icon" /><span class="lbl">{{ item.label }}</span>
              </a>
            } @empty {
              <p class="empty">Sin resultados.</p>
            }
          </nav>
        </div>
      }

      <!-- Menú de usuario (cuenta / workspace / ajustes / salir) -->
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
    .nav { display: flex; position: sticky; top: 0; height: 100vh; flex-shrink: 0; }
    /* Riel (nivel 1): azul profundo corporativo. */
    .rail { width: 60px; background: var(--brand-navy, #08102D); display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 14px 8px; border-right: 1px solid rgba(255, 255, 255, 0.08); }
    .rail :focus-visible { outline-color: var(--brand-cyan, #16C7F4); }
    .brand-ico { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 10px; }
    .insignia { width: 30px; height: 30px; display: block; }
    .rail-toggle { display: grid; place-items: center; width: 28px; height: 24px; margin-bottom: 4px; border: 0; border-radius: 7px; background: rgba(255, 255, 255, 0.05); color: #a3acd3; cursor: pointer; }
    .rail-toggle:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
    .rail-areas { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; overflow-x: hidden; flex: 1; width: 100%; align-items: center; }
    .rail-ico { position: relative; display: grid; place-items: center; width: 42px; height: 42px; border: 0; border-radius: 11px; background: transparent; color: #aeb6da; cursor: pointer; }
    .rail-ico:hover { background: rgba(255, 255, 255, 0.07); color: #fff; }
    .rail-ico.active { background: rgba(18, 91, 234, 0.3); color: #fff; box-shadow: inset 0 0 0 1px rgba(22, 199, 244, 0.22); }
    .rail-ico.active nx-icon { color: var(--brand-cyan, #16C7F4); }
    .rail-ico.active::before { content: ''; position: absolute; left: -8px; top: 9px; bottom: 9px; width: 3px; border-radius: 0 3px 3px 0; background: var(--brand-gradient, linear-gradient(135deg, #125BEA, #16C7F4, #8550E9)); }
    .rail-foot { width: 100%; display: flex; justify-content: center; padding-top: 6px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
    .avatar-btn { background: transparent; }
    .avatar { width: 30px; height: 30px; border-radius: 50%; background: #16307a; box-shadow: 0 0 0 2px rgba(22, 199, 244, 0.35); color: #fff; display: grid; place-items: center; font-weight: 700; text-transform: uppercase; font-size: 13px; }
    /* Panel secundario (nivel 2): azul profundo un punto más claro para separarlo del riel. */
    .panel { width: 236px; background: #0b1430; color: #c9d1ec; display: flex; flex-direction: column; padding: 14px 12px; border-right: 1px solid rgba(255, 255, 255, 0.08); }
    .panel :focus-visible { outline-color: var(--brand-cyan, #16C7F4); }
    .panel-head { padding: 4px 8px 12px; }
    .panel-head strong { color: #fff; font-size: 15px; font-weight: 800; letter-spacing: 0.01em; }
    .filter { position: relative; display: flex; align-items: center; margin-bottom: 10px; }
    .filter nx-icon { position: absolute; left: 10px; color: #8f98c2; pointer-events: none; }
    .filter input { width: 100%; background: #0e1838; color: #fff; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 9px; padding: 8px 30px 8px 32px; font: inherit; font-size: 13px; }
    .filter input::placeholder { color: #8f98c2; }
    .filter input:focus-visible { border-color: var(--brand-cyan, #16C7F4); outline: none; }
    .filter .clear { position: absolute; right: 6px; display: grid; place-items: center; width: 22px; height: 22px; border: 0; border-radius: 6px; background: transparent; color: #a3acd3; cursor: pointer; }
    .filter .clear:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
    .panel-items { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
    a.nav-link { position: relative; display: flex; gap: 11px; align-items: center; padding: 9px 12px; border-radius: 9px; color: #c0c7e3; font-weight: 500; white-space: nowrap; }
    a.nav-link .lbl { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    a.nav-link:hover { background: rgba(255, 255, 255, 0.06); color: #fff; }
    a.nav-link.active { background: rgba(18, 91, 234, 0.28); color: #fff; box-shadow: inset 0 0 0 1px rgba(22, 199, 244, 0.18); }
    a.nav-link.active::before { content: ''; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 0 3px 3px 0; background: var(--brand-gradient, linear-gradient(135deg, #125BEA, #16C7F4, #8550E9)); }
    a.nav-link.active nx-icon { color: var(--brand-cyan, #16C7F4); }
    .empty { color: #8f98c2; font-size: 12.5px; padding: 8px 12px; }
    /* Menú de usuario desplegable (ancla inferior izquierda, sobre el riel). */
    .backdrop { position: fixed; inset: 0; z-index: 40; }
    .user-menu { position: fixed; left: 68px; bottom: 14px; z-index: 41; width: 248px; background: #0e1838; color: #c9d1ec; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 12px; padding: 10px; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5); display: flex; flex-direction: column; gap: 4px; }
    .u-head { display: flex; gap: 10px; align-items: center; padding: 6px 8px 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); margin-bottom: 4px; }
    .avatar.lg { width: 38px; height: 38px; font-size: 15px; }
    .u-who { min-width: 0; }
    .u-who strong { display: block; color: #fff; font-size: 13.5px; }
    .u-who small { display: block; color: #a3acd3; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .u-ws { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px 8px; }
    .u-ws span { font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #8f98c2; }
    .u-ws select { background: #111c45; color: #fff; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; padding: 7px; }
    .u-item { display: flex; gap: 10px; align-items: center; padding: 9px 10px; border: 0; border-radius: 8px; background: transparent; color: #c0c7e3; font: inherit; font-size: 13px; text-align: left; cursor: pointer; width: 100%; }
    .u-item:hover { background: rgba(255, 255, 255, 0.07); color: #fff; }
    /* Móvil: riel + panel se apilan como cabecera desplazable; el menú de usuario pasa a hoja inferior simple. */
    @media (max-width: 900px) {
      .nav { position: relative; height: auto; width: 100%; flex-direction: column; }
      .rail { flex-direction: row; width: 100%; height: auto; border-right: 0; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
      .rail-areas { flex-direction: row; }
      .rail-ico.active::before { display: none; }
      .panel, .nav.panel-hidden .panel { width: 100%; border-right: 0; max-height: 50vh; }
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
  /** Texto del filtro rápido del panel. */
  protected readonly query = signal('');
  /** `true` cuando el panel secundario está oculto (solo riel). Recordado por visor. */
  protected readonly panelHidden = signal<boolean>(loadPanelHidden());
  /** `true` cuando el menú de usuario está abierto. */
  protected readonly userOpen = signal(false);

  /** Áreas visibles según el rol (una por grupo); descarta grupos/ítems que el usuario no puede ver. */
  protected readonly areas = computed(() =>
    visibleGroups(NAV_GROUPS, { isAdmin: this.auth.isAdmin(), isPlatformAdmin: !!this.platform.isPlatformAdmin() }),
  );
  /** Ruta del ítem activo y grupo (área) que lo contiene. */
  protected readonly activeItem = computed(() => activeItemPath(this.areas(), this.url()));
  protected readonly displayGroupId = computed(() => activeGroupId(this.areas(), this.url()) ?? this.areas()[0]?.id ?? '');
  /** `true` si hay una búsqueda activa (el panel muestra coincidencias de TODAS las áreas, en plano). */
  protected readonly filtering = computed(() => normalize(this.query()) !== '');
  /** Título del panel: nombre del área activa, o «Resultados» durante la búsqueda. */
  protected readonly areaLabel = computed(() => {
    if (this.filtering()) return 'Resultados';
    return this.areas().find((g) => g.id === this.displayGroupId())?.label ?? '';
  });
  /** Ítems del panel: en búsqueda, todas las coincidencias; si no, los del área activa. */
  protected readonly panelItems = computed(() => {
    if (this.filtering()) return filterGroups(this.areas(), this.query()).flatMap((g) => g.items);
    return this.areas().find((g) => g.id === this.displayGroupId())?.items ?? [];
  });

  /** Abre un área: navega a su primer ítem y limpia la búsqueda. El panel pasa a mostrar sus ítems. */
  protected openArea(g: NavGroup): void {
    this.query.set('');
    const first = g.items[0];
    if (first) void this.router.navigateByUrl(first.path);
  }

  /** Oculta o muestra el panel secundario y lo recuerda por visor. */
  protected togglePanel(): void {
    const next = !this.panelHidden();
    this.panelHidden.set(next);
    savePanelHidden(next);
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
