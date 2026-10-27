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
 * Navegación lateral. Por defecto es UNA sola columna con NOMBRES CLAROS (icono + nombre) y SIN submenús:
 * cada entrada es un «menú mayor». Al pulsar una entrada con sub-ítems, el menú se contrae a un riel de iconos y
 * aparece su SUBMENÚ a la derecha (patrón tipo Fireflies). Las entradas de un solo destino (Inicio, utilidades)
 * solo navegan. El botón de colapsar (riel o toolbar) deja únicamente el riel de iconos.
 *
 * Presentación pura sobre la sesión y la URL; la arquitectura de información vive en `sidebar.util.ts`. El menú
 * de usuario vive en el toolbar superior (`nx-topbar`). No cambia rutas ni permisos.
 */
@Component({
  selector: 'nx-sidebar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    <aside class="nav" [class.collapsed]="collapsed()" [class.drilled]="!collapsed() && drilled()">
      <!-- Riel de iconos: visible al estar colapsado o al entrar en un submenú. -->
      @if (collapsed() || drilled()) {
        <div class="rail">
          <a class="brand-ico" routerLink="/" aria-label="Nexo: ir al inicio" title="Nexo">
            <img class="insignia" src="brand/insignia.png" width="30" height="30" alt="" />
          </a>
          <button
            type="button"
            class="rail-toggle"
            [attr.aria-label]="collapsed() ? 'Mostrar el menú' : 'Volver al menú'"
            [title]="collapsed() ? 'Mostrar el menú' : 'Volver al menú'"
            (click)="collapsed() ? togglePanel() : exitDrill()"
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
                (click)="onRailIcon(g)"
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
                  (click)="onRailIcon(g)"
                >
                  <nx-icon [name]="g.icon" [size]="19" />
                </button>
              }
            </div>
          }
        </div>
      }

      <!-- Lista con NOMBRES (estado por defecto, sin submenús). -->
      @if (!collapsed() && !drilled()) {
        <div class="list">
          <header class="list-head">
            <a class="brand" routerLink="/" aria-label="Nexo: ir al inicio" title="Nexo">
              <img class="insignia" src="brand/insignia.png" width="28" height="28" alt="" />
              <span class="brand-name">Nexo</span>
            </a>
            <button type="button" class="list-toggle" aria-label="Ocultar el menú" title="Ocultar el menú" (click)="togglePanel()">
              <nx-icon name="sidebarToggle" [size]="16" />
            </button>
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

          <nav class="list-items" aria-label="Navegación principal">
            @if (filtering()) {
              <!-- Búsqueda: resultados como enlaces directos. -->
              @for (item of searchItems(); track item.path) {
                <a
                  class="m-item"
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
            } @else {
              <!-- Menús mayores (nombres claros, sin submenús). -->
              <div class="list-main">
                @for (g of mainAreas(); track g.id) {
                  @if (hasChildren(g)) {
                    <button type="button" class="m-item" [class.on]="displayGroupId() === g.id" (click)="drill(g)" [title]="g.label">
                      <nx-icon [name]="g.icon" /><span class="lbl">{{ g.label }}</span>
                      <nx-icon class="chev" name="chevronRight" [size]="15" />
                    </button>
                  } @else {
                    <a class="m-item" [routerLink]="g.items[0].path" [class.active]="activeItem() === g.items[0].path"
                      [attr.aria-current]="activeItem() === g.items[0].path ? 'page' : null" [title]="g.label">
                      <nx-icon [name]="g.icon" /><span class="lbl">{{ g.label }}</span>
                    </a>
                  }
                }
              </div>
              <!-- Utilidades ancladas al PIE del menú. -->
              @if (footerAreas().length) {
                <div class="list-foot">
                  @for (g of footerAreas(); track g.id) {
                    @if (hasChildren(g)) {
                      <button type="button" class="m-item" [class.on]="displayGroupId() === g.id" (click)="drill(g)" [title]="g.label">
                        <nx-icon [name]="g.icon" /><span class="lbl">{{ g.label }}</span>
                        <nx-icon class="chev" name="chevronRight" [size]="15" />
                      </button>
                    } @else {
                      <a class="m-item" [routerLink]="g.items[0].path" [class.active]="activeItem() === g.items[0].path"
                        [attr.aria-current]="activeItem() === g.items[0].path ? 'page' : null" [title]="g.label">
                        <nx-icon [name]="g.icon" /><span class="lbl">{{ g.label }}</span>
                      </a>
                    }
                  }
                </div>
              }
            }
          </nav>
        </div>
      }

      <!-- Submenú del menú seleccionado (al hacer «drill»). -->
      @if (!collapsed() && drilled() && drillGroup(); as g) {
        <div class="panel">
          <header class="panel-head">
            <button type="button" class="back" aria-label="Volver al menú" title="Volver al menú" (click)="exitDrill()">
              <nx-icon name="arrowLeft" [size]="18" />
            </button>
            <strong>{{ g.label }}</strong>
          </header>
          <nav class="panel-items" aria-label="Submenú">
            @for (item of g.items; track item.path) {
              <a
                class="nav-link"
                [routerLink]="item.path"
                [class.active]="activeItem() === item.path"
                [attr.aria-current]="activeItem() === item.path ? 'page' : null"
                [title]="item.label"
              >
                <nx-icon [name]="item.icon" /><span class="lbl">{{ item.label }}</span>
              </a>
            }
          </nav>
        </div>
      }
    </aside>
  `,
  styles: `
    :host { display: contents; }
    .nav { display: flex; position: sticky; top: 0; height: 100vh; flex-shrink: 0; }
    .insignia { display: block; }

    /* Riel de iconos (colapsado o en submenú). */
    .rail { width: 60px; background: var(--brand-navy, #08102D); display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 14px 8px; border-right: 1px solid rgba(255, 255, 255, 0.08); }
    .rail :focus-visible { outline-color: var(--brand-cyan, #16C7F4); }
    .brand-ico { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 10px; }
    .rail-toggle { display: grid; place-items: center; width: 30px; height: 26px; margin-bottom: 4px; border: 0; border-radius: 7px; background: rgba(255, 255, 255, 0.05); color: #a3acd3; cursor: pointer; }
    .rail-toggle:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
    .rail-areas { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; overflow-x: hidden; flex: 1; width: 100%; align-items: center; }
    .rail-ico { position: relative; display: grid; place-items: center; width: 42px; height: 42px; border: 0; border-radius: 11px; background: transparent; color: #aeb6da; cursor: pointer; }
    .rail-ico:hover { background: rgba(255, 255, 255, 0.07); color: #fff; }
    .rail-ico.active { background: rgba(18, 91, 234, 0.3); color: #fff; box-shadow: inset 0 0 0 1px rgba(22, 199, 244, 0.22); }
    .rail-ico.active nx-icon { color: var(--brand-cyan, #16C7F4); }
    .rail-ico.active::before { content: ''; position: absolute; left: -8px; top: 9px; bottom: 9px; width: 3px; border-radius: 0 3px 3px 0; background: var(--brand-gradient, linear-gradient(135deg, #125BEA, #16C7F4, #8550E9)); }
    .rail-foot { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 4px; padding-top: 6px; margin-top: 2px; border-top: 1px solid rgba(255, 255, 255, 0.08); }

    /* Lista con nombres (estado por defecto). */
    .list { width: 256px; background: var(--brand-navy, #08102D); color: #c9d1ec; display: flex; flex-direction: column; padding: 12px 12px 14px; border-right: 1px solid rgba(255, 255, 255, 0.08); }
    .list :focus-visible { outline-color: var(--brand-cyan, #16C7F4); }
    .list-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .brand { display: flex; align-items: center; gap: 10px; text-decoration: none; }
    .brand-name { color: #fff; font-size: 18px; font-weight: 800; letter-spacing: .01em; }
    .list-toggle { display: grid; place-items: center; width: 30px; height: 28px; border: 0; border-radius: 7px; background: rgba(255, 255, 255, 0.05); color: #a3acd3; cursor: pointer; }
    .list-toggle:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
    .list-items { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 2px; }
    .list-main { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
    .list-foot { margin-top: auto; display: flex; flex-direction: column; gap: 2px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
    .m-item { position: relative; display: flex; gap: 12px; align-items: center; width: 100%; padding: 10px 12px; border: 0; border-radius: 10px; background: transparent; color: #c0c7e3; font: inherit; font-size: 14px; font-weight: 600; text-align: left; text-decoration: none; cursor: pointer; white-space: nowrap; }
    .m-item .lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .m-item .chev { color: #8f98c2; flex-shrink: 0; }
    .m-item nx-icon:first-child { color: #aeb6da; flex-shrink: 0; }
    .m-item:hover { background: rgba(255, 255, 255, 0.07); color: #fff; }
    .m-item:hover nx-icon { color: #fff; }
    .m-item.on nx-icon:first-child, .m-item.active nx-icon:first-child { color: var(--brand-cyan, #16C7F4); }
    .m-item.active { background: rgba(18, 91, 234, 0.28); color: #fff; }
    .m-item.active::before { content: ''; position: absolute; left: 0; top: 9px; bottom: 9px; width: 3px; border-radius: 0 3px 3px 0; background: var(--brand-gradient, linear-gradient(135deg, #125BEA, #16C7F4, #8550E9)); }

    /* Búsqueda. */
    .filter { position: relative; display: flex; align-items: center; margin-bottom: 10px; }
    .filter nx-icon { position: absolute; left: 10px; color: #8f98c2; pointer-events: none; }
    .filter input { width: 100%; background: #0e1838; color: #fff; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 9px; padding: 8px 30px 8px 32px; font: inherit; font-size: 13px; }
    .filter input::placeholder { color: #8f98c2; }
    .filter input:focus-visible { border-color: var(--brand-cyan, #16C7F4); outline: none; }
    .filter .clear { position: absolute; right: 6px; display: grid; place-items: center; width: 22px; height: 22px; border: 0; border-radius: 6px; background: transparent; color: #a3acd3; cursor: pointer; }
    .filter .clear:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
    .empty { color: #8f98c2; font-size: 12.5px; padding: 8px 12px; }

    /* Submenú (nivel 2). */
    .panel { width: 236px; background: #0b1430; color: #c9d1ec; display: flex; flex-direction: column; padding: 14px 12px; border-right: 1px solid rgba(255, 255, 255, 0.08); }
    .panel :focus-visible { outline-color: var(--brand-cyan, #16C7F4); }
    .panel-head { display: flex; align-items: center; gap: 8px; padding: 2px 4px 12px; }
    .panel-head .back { display: grid; place-items: center; width: 30px; height: 30px; border: 0; border-radius: 8px; background: transparent; color: #a3acd3; cursor: pointer; flex-shrink: 0; }
    .panel-head .back:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
    .panel-head strong { color: #fff; font-size: 15px; font-weight: 800; }
    .panel-items { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
    a.nav-link { position: relative; display: flex; gap: 11px; align-items: center; padding: 9px 12px; border-radius: 9px; color: #c0c7e3; font-weight: 500; white-space: nowrap; text-decoration: none; }
    a.nav-link .lbl { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    a.nav-link nx-icon { color: #aeb6da; flex-shrink: 0; }
    a.nav-link:hover { background: rgba(255, 255, 255, 0.06); color: #fff; }
    a.nav-link.active { background: rgba(18, 91, 234, 0.28); color: #fff; box-shadow: inset 0 0 0 1px rgba(22, 199, 244, 0.18); }
    a.nav-link.active::before { content: ''; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 0 3px 3px 0; background: var(--brand-gradient, linear-gradient(135deg, #125BEA, #16C7F4, #8550E9)); }
    a.nav-link.active nx-icon { color: var(--brand-cyan, #16C7F4); }

    @media (max-width: 900px) {
      .nav { position: relative; height: auto; width: 100%; flex-direction: column; }
      .rail, .list { flex-direction: row; width: 100%; height: auto; border-right: 0; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
      .list { flex-wrap: wrap; }
      .rail-areas, .rail-foot { flex-direction: row; }
      .rail-foot { border-top: 0; border-left: 1px solid rgba(255, 255, 255, 0.08); padding-top: 0; padding-left: 6px; margin-left: 2px; }
      .rail-ico.active::before { display: none; }
      .panel { width: 100%; border-right: 0; max-height: 50vh; }
    }
  `,
})
export class SidebarComponent {
  protected readonly auth = inject(AuthService);
  protected readonly platform = inject(PlatformApi);
  private readonly router = inject(Router);
  private readonly layout = inject(LayoutService);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  protected readonly query = signal('');
  /** Submenú abierto (drill); `null` = lista de menús mayores. */
  private readonly drillId = signal<string | null>(null);

  /** Áreas visibles según el rol. */
  private readonly areas = computed(() =>
    visibleGroups(NAV_GROUPS, { isAdmin: this.auth.isAdmin(), isPlatformAdmin: !!this.platform.isPlatformAdmin() }),
  );
  protected readonly mainAreas = computed(() => this.areas().filter((g) => !g.footer));
  protected readonly footerAreas = computed(() => this.areas().filter((g) => g.footer));
  protected readonly activeItem = computed(() => activeItemPath(this.areas(), this.url()));
  protected readonly displayGroupId = computed(() => activeGroupId(this.areas(), this.url()) ?? '');
  protected readonly filtering = computed(() => normalize(this.query()) !== '');
  /** Resultados de búsqueda (enlaces planos). */
  protected readonly searchItems = computed(() => filterGroups(this.areas(), this.query()).flatMap((g) => g.items));

  /**
   * El menú está colapsado (solo riel de iconos) si el visor lo ocultó o estamos en el espacio de Ajustes
   * (/ajustes trae su propia barra lateral). Al salir, vuelve a su estado recordado.
   */
  private readonly onAjustes = computed(() => {
    const u = this.url().split('?')[0].split('#')[0];
    return u === '/ajustes' || u.startsWith('/ajustes/');
  });
  protected readonly collapsed = computed(() => this.layout.panelHidden() || this.onAjustes());
  /** Grupo cuyo submenú está abierto (si existe y es visible). */
  protected readonly drillGroup = computed(() => this.areas().find((g) => g.id === this.drillId()));
  protected readonly drilled = computed(() => !!this.drillGroup());

  /** `true` si el menú tiene sub-ítems (no es un destino único con el mismo nombre). */
  protected hasChildren(g: NavGroup): boolean {
    return g.items.length > 1 || g.items[0].label !== g.label;
  }

  /** Abre el submenú de un menú mayor y navega a su primer ítem. */
  protected drill(g: NavGroup): void {
    this.query.set('');
    this.drillId.set(g.id);
    const first = g.items[0];
    if (first) void this.router.navigateByUrl(first.path);
  }

  /** Cierra el submenú y vuelve a la lista de menús mayores. */
  protected exitDrill(): void {
    this.drillId.set(null);
  }

  /** Clic en un icono del riel: si tiene submenú lo abre; si no, navega. Siempre va a su primer ítem. */
  protected onRailIcon(g: NavGroup): void {
    this.query.set('');
    const first = g.items[0];
    if (first) void this.router.navigateByUrl(first.path);
    if (!this.collapsed()) this.drillId.set(this.hasChildren(g) ? g.id : null);
  }

  /** Colapsa o muestra el menú (estado compartido con el toolbar). */
  protected togglePanel(): void {
    this.layout.togglePanel();
  }
}
