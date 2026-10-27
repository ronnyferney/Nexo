import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { PlatformApi } from '../core/platform.api';
import { IconComponent } from '../shared/icon.component';
import { LayoutService } from './layout.service';
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

/**
 * Navegación lateral de DOS NIVELES (patrón de apps modernas tipo Fireflies), con los colores corporativos de NEXO:
 *  - **Riel** angosto de iconos: un icono por ÁREA principal (grupo). Debajo, separado, las utilidades de pie
 *    (Conecta tus apps, Conecta tu IA, Ajustes). El menú de usuario vive en el toolbar superior (`nx-topbar`).
 *  - **Panel secundario contextual**: muestra los HIJOS del área activa (o las coincidencias de la búsqueda), con su
 *    título. Se puede ocultar para ganar espacio (estado compartido en `LayoutService`, recordado por visor).
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
    @media (max-width: 900px) {
      .nav { position: relative; height: auto; width: 100%; flex-direction: column; }
      .rail { flex-direction: row; width: 100%; height: auto; border-right: 0; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
      .rail-areas, .rail-foot { flex-direction: row; }
      .rail-foot { border-top: 0; border-left: 1px solid rgba(255, 255, 255, 0.08); padding-top: 0; padding-left: 6px; margin-left: 2px; }
      .rail-ico.active::before { display: none; }
      .panel, .nav.panel-hidden .panel { width: 100%; border-right: 0; max-height: 50vh; }
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
  private readonly layout = inject(LayoutService);
  protected readonly query = signal('');
  /** Estado de colapso compartido con el toolbar (`LayoutService`). */
  protected readonly panelHidden = this.layout.panelHidden;
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
    this.layout.togglePanel();
  }
}
