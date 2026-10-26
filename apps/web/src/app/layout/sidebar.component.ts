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
} from './sidebar.util';

export type { NavGroup, NavItem } from './sidebar.util';

/** Clave de `localStorage` donde se guardan los ids de los grupos plegados (por visor). */
const COLLAPSE_STORE_KEY = 'nexo.sidebar.collapsed';

/** Lee los grupos plegados de `localStorage`; degrada a vacío si no hay almacenamiento o el dato es inválido. */
function loadCollapsed(): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_STORE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

/** Persiste los grupos plegados; si el almacenamiento no está disponible, no hace nada. */
function saveCollapsed(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(COLLAPSE_STORE_KEY, JSON.stringify([...ids]));
  } catch {
    // almacenamiento no disponible (modo privado estricto): el pliegue no se recuerda, pero la UI sigue funcionando
  }
}

/**
 * Barra lateral (Sidebar) del «chrome» de la aplicación, al estilo de una app empresarial (WMS/fleet):
 * marca, filtro rápido, navegación por secciones agrupadas y colapsables, selector de workspace y menú
 * de usuario.
 *
 * Es presentación pura sobre el estado de sesión (`AuthService`/`PlatformApi`) y la URL actual: la
 * arquitectura de información y la lógica (grupos, filtrado, ítem/grupo activo) viven en `sidebar.util.ts`.
 * El pliegue de cada sección se recuerda por visor en `localStorage`.
 *
 * Uso: `<nx-sidebar />` dentro del shell. El `:host` usa `display: contents` para que el
 * `<aside>` sea el hijo flex directo del shell.
 */
@Component({
  selector: 'nx-sidebar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    <aside class="sidebar">
      <a class="brand" routerLink="/" aria-label="Nexo: ir al inicio">
        <img class="insignia" src="brand/insignia.png" width="38" height="38" alt="" />
        <span class="wordmark" aria-hidden="true"><strong>Nexo</strong><small lang="en">AI Agents Platform</small></span>
      </a>
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
      <nav aria-label="Navegación principal">
        @for (group of groups(); track group.id) {
          @if (group.pinned) {
            <div class="nav-group" role="group" [attr.aria-label]="group.label">
              @for (item of group.items; track item.path) {
                <a
                  class="nav-link"
                  [routerLink]="item.path"
                  [class.active]="activeItem() === item.path"
                  [attr.aria-current]="activeItem() === item.path ? 'page' : null"
                  [title]="item.label"
                >
                  <nx-icon [name]="item.icon" />{{ item.label }}
                </a>
              }
            </div>
          } @else {
            <button
              type="button"
              class="group-head"
              [id]="'grp-head-' + group.id"
              [class.active]="activeGroup() === group.id"
              [attr.aria-expanded]="isExpanded(group.id)"
              [attr.aria-controls]="'grp-items-' + group.id"
              (click)="toggle(group.id)"
            >
              <nx-icon class="g-ico" [name]="group.icon" [size]="16" />
              <span class="g-label">{{ group.label }}</span>
              <nx-icon class="chev" [name]="isExpanded(group.id) ? 'chevronUp' : 'chevronDown'" [size]="15" />
            </button>
            @if (isExpanded(group.id)) {
              <div class="nav-group" role="group" [id]="'grp-items-' + group.id" [attr.aria-labelledby]="'grp-head-' + group.id">
                @for (item of group.items; track item.path) {
                  <a
                    class="nav-link sub"
                    [routerLink]="item.path"
                    [class.active]="activeItem() === item.path"
                    [attr.aria-current]="activeItem() === item.path ? 'page' : null"
                    [title]="item.label"
                  >
                    <nx-icon [name]="item.icon" />{{ item.label }}
                  </a>
                }
              </div>
            }
          }
        } @empty {
          <p class="empty">Sin resultados.</p>
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
    /* Filtro rápido: campo oscuro con ícono de lupa y botón de limpiar. */
    .filter { position: relative; display: flex; align-items: center; margin-bottom: 10px; }
    .filter nx-icon { position: absolute; left: 10px; color: #8f98c2; pointer-events: none; }
    .filter input { width: 100%; background: #0e1838; color: #fff; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 9px; padding: 8px 30px 8px 32px; font: inherit; font-size: 13px; }
    .filter input::placeholder { color: #8f98c2; }
    .filter input:focus-visible { border-color: var(--brand-cyan, #16C7F4); outline: none; }
    .filter .clear { position: absolute; right: 6px; display: grid; place-items: center; width: 22px; height: 22px; border: 0; border-radius: 6px; background: transparent; color: #a3acd3; cursor: pointer; }
    .filter .clear:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
    nav { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
    .nav-group { display: flex; flex-direction: column; gap: 2px; }
    /* Encabezado de sección colapsable: botón ancho completo, con ícono, etiqueta y chevron. */
    .group-head { display: flex; align-items: center; gap: 11px; width: 100%; margin-top: 8px; padding: 8px 12px; border: 0; border-radius: 9px; background: transparent; color: #8f98c2; font: inherit; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; text-align: left; }
    .group-head:first-of-type { margin-top: 2px; }
    .group-head:hover { background: rgba(255, 255, 255, 0.06); color: #c9d1ec; }
    .group-head .g-label { flex: 1; min-width: 0; }
    .group-head .chev { color: #6f78a2; transition: color 0.15s; }
    .group-head.active { color: #fff; }
    .group-head.active .g-ico { color: var(--brand-cyan, #16C7F4); }
    nav a.nav-link { position: relative; display: flex; gap: 11px; align-items: center; padding: 9px 12px; border-radius: 9px; color: #c0c7e3; font-weight: 500; }
    nav a.nav-link.sub { padding-left: 24px; }
    nav a.nav-link:hover { background: rgba(255, 255, 255, 0.06); color: #fff; }
    /* Activo: fondo azul eléctrico translúcido (texto blanco > 12:1) e indicador cian (> 3:1 sobre el azul profundo). */
    nav a.nav-link.active { background: rgba(18, 91, 234, 0.28); color: #fff; box-shadow: inset 0 0 0 1px rgba(22, 199, 244, 0.18); }
    nav a.nav-link.active::before { content: ''; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 0 3px 3px 0; background: var(--brand-gradient, linear-gradient(135deg, #125BEA, #16C7F4, #8550E9)); }
    nav a.nav-link.active nx-icon { color: var(--brand-cyan, #16C7F4); }
    .empty { color: #8f98c2; font-size: 12.5px; padding: 8px 12px; }
    .spacer { flex: 1; }
    .ws { margin-bottom: 10px; background: #111c45; color: #fff; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; padding: 7px; }
    .user { display: flex; align-items: center; gap: 10px; padding: 10px 6px 0; border-top: 1px solid rgba(255, 255, 255, 0.08); }
    .user .btn { color: #c0c7e3; }
    .avatar { width: 32px; height: 32px; border-radius: 50%; background: #16307a; box-shadow: 0 0 0 2px rgba(22, 199, 244, 0.35); color: #fff; display: grid; place-items: center; font-weight: 700; text-transform: uppercase; }
    .who { flex: 1; min-width: 0; }
    .who strong { display: block; color: #fff; font-size: 13px; }
    .who small { display: block; color: #a3acd3; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* Móvil: la barra pasa a cabecera a lo ancho; la navegación se desplaza en vertical con tope de alto. */
    @media (max-width: 900px) { .sidebar { width: 100%; height: auto; position: relative; border-right: 0; border-bottom: 1px solid rgba(255, 255, 255, 0.08); } .brand { padding-bottom: 10px; } nav { max-height: 55vh; } .spacer, .user, .ws { display: none; } }
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
  /** Texto del filtro rápido. */
  protected readonly query = signal('');
  /** Ids de grupos plegados por el usuario, persistidos por visor. */
  private readonly collapsed = signal<ReadonlySet<string>>(loadCollapsed());

  /** Grupos visibles según el rol: se descartan ítems y grupos que el usuario no puede ver. */
  private readonly visible = computed(() =>
    visibleGroups(NAV_GROUPS, { isAdmin: this.auth.isAdmin(), isPlatformAdmin: !!this.platform.isPlatformAdmin() }),
  );
  /** Grupos finalmente mostrados: los visibles, filtrados por el texto de búsqueda. */
  protected readonly groups = computed(() => filterGroups(this.visible(), this.query()));
  /** `true` si hay una búsqueda activa (fuerza el despliegue de todas las secciones con coincidencias). */
  protected readonly filtering = computed(() => normalize(this.query()) !== '');
  /** Ruta del ítem activo (coincidencia más específica) y grupo que lo contiene. */
  protected readonly activeItem = computed(() => activeItemPath(this.visible(), this.url()));
  protected readonly activeGroup = computed(() => activeGroupId(this.visible(), this.url()));

  /** Una sección se ve desplegada si hay búsqueda, si contiene al ítem activo o si no está plegada. */
  protected isExpanded(id: string): boolean {
    if (this.filtering()) return true;
    if (this.activeGroup() === id) return true;
    return !this.collapsed().has(id);
  }

  /** Pliega o despliega la sección y persiste el estado. */
  protected toggle(id: string): void {
    const next = new Set(this.collapsed());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.collapsed.set(next);
    saveCollapsed(next);
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
