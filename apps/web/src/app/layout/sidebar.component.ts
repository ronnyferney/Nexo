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
    /* almacenamiento no disponible: no se recuerda, pero la UI sigue funcionando */
  }
}

/**
 * Navegación lateral de DOS NIVELES (patrón de apps modernas tipo Fireflies), con los colores corporativos de NEXO:
 *  - **Riel** angosto de iconos: un icono por ÁREA principal (grupo). Debajo, separado, las utilidades de pie
 *    (Conecta tus apps, Conecta tu IA, Ajustes); al fondo, el usuario (con desplegable de cuenta y cierre de sesión).
 *  - **Panel secundario contextual**: muestra los HIJOS del área activa (o las coincidencias de la búsqueda), con su
 *    título. Se puede ocultar para ganar espacio (recordado por visor).
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
    <aside class="nav" [class.panel-hidden]="!panelVisible()">
      <!-- Nivel 1: riel de iconos (áreas principales + utilidades + usuario) -->
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
          <nx-icon name="sidebarToggle" [size]="16" />
        </button>

        <nav class="rail-areas" aria-label="Áreas">
          @for (g of mainAreas(); track g.id) {
            <button
              type="button"
              class="rail-ico area"
              [class.active]="displayGroupId() === g.id"
              [attr.aria-current]="displayGroupId() === g.id ? 'true' : null"
              [attr.aria-label]="g.label"
              [title]="g.label"
              (click)="openArea(g)"
            >
              <nx-icon [name]="g.icon" [size]="19" />
            </button>
          }
        </nav>

        @if (footerAreas().length) {
          <div class="rail-foot" role="group" aria-label="Utilidades">
            @for (g of footerAreas(); track g.id) {
              <button
                type="button"
                class="rail-ico foot"
                [class.active]="displayGroupId() === g.id"
                [attr.aria-current]="displayGroupId() === g.id ? 'true' : null"
                [attr.aria-label]="g.label"
                [title]="g.label"
                (click)="openArea(g)"
              >
                <nx-icon [name]="g.icon" [size]="19" />
              </button>
            }
          </div>
        }

        @if (auth.me(); as me) {
          <button
            type="button"
            class="rail-user"
            aria-haspopup="menu"
            [attr.aria-expanded]="userOpen()"
            [attr.aria-label]="'Menú de usuario: ' + me.name"
            [title]="me.name"
            (click)="toggleUser()"
          >
            <span class="avatar">{{ me.name.charAt(0) }}</span>
          </button>
        }
      </div>

      <!-- Nivel 2: panel secundario contextual (hijos del área activa) -->
      @if (panelVisible()) {
        <div class="panel">
          <header class="panel-head"><strong>{{ areaLabel() }}</strong></header>
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

      <!-- Menú de usuario, anclado sobre el riel: nombre+correo, organizaciones, cuenta, administración, salir -->
      @if (userOpen() && auth.me(); as me) {
        <div class="backdrop" (click)="closeUser()"></div>
        <div class="user-menu" role="menu" aria-label="Menú de usuario">
          <div class="u-head">
            <strong>{{ me.name }}</strong>
            <small>{{ me.email }}</small>
          </div>
          <div class="u-sec" role="group" aria-label="Organizaciones">
            @for (m of me.memberships; track m.workspace.id) {
              <button
                type="button"
                class="u-item"
                role="menuitemradio"
                [attr.aria-checked]="m.workspace.id === me.activeWorkspaceId"
                (click)="switchFrom(m.workspace.id, me.activeWorkspaceId)"
              >
                <nx-icon [name]="m.workspace.id === me.activeWorkspaceId ? 'check' : 'building'" [size]="16" />{{ m.workspace.name }}
              </button>
            }
          </div>
          <div class="u-sec">
            <a class="u-item" role="menuitem" routerLink="/account" (click)="closeUser()"><nx-icon name="user" [size]="16" />Perfil y cuenta</a>
          </div>
          @if (auth.isAdmin()) {
            <div class="u-sec">
              <a class="u-item" role="menuitem" routerLink="/ajustes" (click)="closeUser()"><nx-icon name="building" [size]="16" />Administración</a>
              <a class="u-item" role="menuitem" routerLink="/admin/settings" (click)="closeUser()"><nx-icon name="settings" [size]="16" />Configuración</a>
            </div>
          }
          <div class="u-sec">
            <button type="button" class="u-item danger" role="menuitem" aria-label="Cerrar sesión" (click)="auth.logout()"><nx-icon name="logout" [size]="16" />Cerrar sesión</button>
          </div>
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
    .rail-toggle { display: grid; place-items: center; width: 30px; height: 26px; margin-bottom: 4px; border: 0; border-radius: 7px; background: rgba(255, 255, 255, 0.05); color: #a3acd3; cursor: pointer; }
    .rail-toggle:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
    .rail-areas { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; overflow-x: hidden; flex: 1; width: 100%; align-items: center; }
    .rail-ico { position: relative; display: grid; place-items: center; width: 42px; height: 42px; border: 0; border-radius: 11px; background: transparent; color: #aeb6da; cursor: pointer; }
    .rail-ico:hover { background: rgba(255, 255, 255, 0.07); color: #fff; }
    .rail-ico.active { background: rgba(18, 91, 234, 0.3); color: #fff; box-shadow: inset 0 0 0 1px rgba(22, 199, 244, 0.22); }
    .rail-ico.active nx-icon { color: var(--brand-cyan, #16C7F4); }
    .rail-ico.active::before { content: ''; position: absolute; left: -8px; top: 9px; bottom: 9px; width: 3px; border-radius: 0 3px 3px 0; background: var(--brand-gradient, linear-gradient(135deg, #125BEA, #16C7F4, #8550E9)); }
    .rail-foot { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 4px; padding-top: 6px; margin-top: 2px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
    .rail-user { width: 100%; display: flex; justify-content: center; padding-top: 8px; margin-top: 4px; border-top: 1px solid rgba(255, 255, 255, 0.08); border-radius: 0; background: transparent; border-left: 0; border-right: 0; border-bottom: 0; cursor: pointer; }
    .avatar { width: 32px; height: 32px; border-radius: 50%; background: #16307a; box-shadow: 0 0 0 2px rgba(22, 199, 244, 0.35); color: #fff; display: grid; place-items: center; font-weight: 700; text-transform: uppercase; font-size: 13px; }
    /* Panel secundario (nivel 2). */
    .panel { width: 236px; background: #0b1430; color: #c9d1ec; display: flex; flex-direction: column; padding: 14px 12px; border-right: 1px solid rgba(255, 255, 255, 0.08); }
    .panel :focus-visible { outline-color: var(--brand-cyan, #16C7F4); }
    .panel-head { padding: 4px 8px 12px; }
    .panel-head strong { color: #fff; font-size: 15px; font-weight: 800; }
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
    /* Menú de usuario desplegable (sobre el riel, abajo a la izquierda). */
    .backdrop { position: fixed; inset: 0; z-index: 40; }
    .user-menu { position: fixed; left: 68px; bottom: 14px; z-index: 41; width: 250px; background: #0e1838; color: #c9d1ec; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 12px; padding: 10px; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5); display: flex; flex-direction: column; gap: 4px; }
    .u-head { padding: 4px 10px 10px; min-width: 0; }
    .u-head strong { display: block; color: #fff; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .u-head small { display: block; color: #a3acd3; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .u-sec { display: flex; flex-direction: column; gap: 2px; padding: 6px 0; border-top: 1px solid rgba(255, 255, 255, 0.08); }
    .u-item { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border: 0; border-radius: 8px; background: transparent; color: #c0c7e3; font: inherit; font-size: 13px; text-align: left; cursor: pointer; width: 100%; }
    .u-item nx-icon { color: #8f98c2; flex-shrink: 0; }
    .u-item:hover { background: rgba(255, 255, 255, 0.07); color: #fff; }
    .u-item[aria-checked='true'] { color: #fff; }
    .u-item[aria-checked='true'] nx-icon { color: var(--brand-cyan, #16C7F4); }
    .u-item.danger:hover { background: rgba(224, 49, 79, 0.14); color: #ff8aa0; }
    .u-item.danger:hover nx-icon { color: #ff8aa0; }
    @media (max-width: 900px) {
      .nav { position: relative; height: auto; width: 100%; flex-direction: column; }
      .rail { flex-direction: row; width: 100%; height: auto; border-right: 0; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
      .rail-areas, .rail-foot { flex-direction: row; }
      .rail-foot, .rail-user { border-top: 0; border-left: 1px solid rgba(255, 255, 255, 0.08); padding-top: 0; padding-left: 6px; margin-left: 2px; }
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
  protected readonly query = signal('');
  protected readonly panelHidden = signal<boolean>(loadPanelHidden());
  protected readonly userOpen = signal(false);
  /**
   * El espacio de Ajustes (/ajustes) trae su propia barra lateral de secciones, así que el panel secundario del
   * menú (que allí solo mostraría «Ajustes») se oculta para no duplicar navegación. No altera la preferencia del
   * visor: al salir de Ajustes, el panel vuelve a su estado recordado.
   */
  private readonly onAjustes = computed(() => {
    const u = this.url().split('?')[0].split('#')[0];
    return u === '/ajustes' || u.startsWith('/ajustes/');
  });
  protected readonly panelVisible = computed(() => !this.panelHidden() && !this.onAjustes());

  /** Áreas visibles según el rol. */
  private readonly areas = computed(() =>
    visibleGroups(NAV_GROUPS, { isAdmin: this.auth.isAdmin(), isPlatformAdmin: !!this.platform.isPlatformAdmin() }),
  );
  /** Áreas principales (riel superior) y de pie (utilidades). */
  protected readonly mainAreas = computed(() => this.areas().filter((g) => !g.footer));
  protected readonly footerAreas = computed(() => this.areas().filter((g) => g.footer));
  protected readonly activeItem = computed(() => activeItemPath(this.areas(), this.url()));
  protected readonly displayGroupId = computed(() => activeGroupId(this.areas(), this.url()) ?? this.mainAreas()[0]?.id ?? '');
  protected readonly filtering = computed(() => normalize(this.query()) !== '');
  /** Título del panel: nombre del área activa, o «Resultados» durante la búsqueda. */
  protected readonly areaLabel = computed(() => {
    if (this.filtering()) return 'Resultados';
    return this.areas().find((g) => g.id === this.displayGroupId())?.label ?? '';
  });
  /** Hijos del panel: en búsqueda, todas las coincidencias; si no, los del área activa. */
  protected readonly panelItems = computed(() => {
    if (this.filtering()) return filterGroups(this.areas(), this.query()).flatMap((g) => g.items);
    return this.areas().find((g) => g.id === this.displayGroupId())?.items ?? [];
  });

  /** Abre un área: navega a su primer hijo y limpia la búsqueda. El panel pasa a mostrar sus hijos. */
  protected openArea(g: NavGroup): void {
    this.query.set('');
    const first = g.items[0];
    if (first) void this.router.navigateByUrl(first.path);
  }

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

  /** Cambia de organización (workspace); si ya es la activa, solo cierra el menú. */
  async switchFrom(id: string, activeId: string) {
    if (id === activeId) {
      this.closeUser();
      return;
    }
    await this.auth.switchWorkspace(id);
    location.reload();
  }
}
