import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { PlatformApi } from '../core/platform.api';
import { IconComponent } from '../shared/icon.component';
import { activeItemPath, filterGroups, NAV_GROUPS, normalize, visibleGroups } from './sidebar.util';

export type { NavGroup, NavItem } from './sidebar.util';

/** Clave de `localStorage` donde se recuerda si el sidebar está plegado a riel de iconos (por visor). */
const COLLAPSE_STORE_KEY = 'nexo.sidebar.rail';

/** Lee el estado plegado del sidebar; degrada a expandido si no hay almacenamiento o el dato es inválido. */
function loadRail(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_STORE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persiste el estado plegado; si el almacenamiento no está disponible, no hace nada. */
function saveRail(rail: boolean): void {
  try {
    localStorage.setItem(COLLAPSE_STORE_KEY, rail ? '1' : '0');
  } catch {
    // almacenamiento no disponible (modo privado estricto): el pliegue no se recuerda, pero la UI sigue funcionando
  }
}

/**
 * Barra lateral (Sidebar) del «chrome», con el patrón de navegación de dos estados inspirado en apps modernas
 * (Fireflies): **expandida** (icono + etiqueta, agrupada por secciones) o **plegada a riel** (solo iconos con tooltip),
 * conmutable por el usuario y recordada por visor. Mantiene los colores corporativos de NEXO (azul profundo, azul
 * eléctrico y cian del kit de marca; el ítem activo lleva el degradado de marca como indicador).
 *
 * Es presentación pura sobre el estado de sesión (`AuthService`/`PlatformApi`) y la URL actual: la arquitectura de
 * información (grupos, filtrado, ítem activo) vive en `sidebar.util.ts`. No cambia rutas ni permisos.
 *
 * Uso: `<nx-sidebar />` dentro del shell. El `:host` usa `display: contents` para que el `<aside>` sea el hijo flex
 * directo del shell.
 */
@Component({
  selector: 'nx-sidebar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    <aside class="sidebar" [class.rail]="rail()">
      <div class="top">
        <a class="brand" routerLink="/" aria-label="Nexo: ir al inicio" [title]="rail() ? 'Nexo' : ''">
          <img class="insignia" src="brand/insignia.png" width="34" height="34" alt="" />
          @if (!rail()) {
            <span class="wordmark" aria-hidden="true"><strong>Nexo</strong><small lang="en">AI Agents Platform</small></span>
          }
        </a>
        <button
          type="button"
          class="collapse"
          [attr.aria-expanded]="!rail()"
          [attr.aria-label]="rail() ? 'Expandir el menú' : 'Plegar el menú'"
          [title]="rail() ? 'Expandir el menú' : 'Plegar el menú'"
          (click)="toggleRail()"
        >
          <nx-icon [name]="rail() ? 'arrowRight' : 'arrowLeft'" [size]="16" />
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

      <nav aria-label="Navegación principal">
        @for (group of groups(); track group.id) {
          @if (!group.pinned && !rail() && !filtering()) {
            <p class="section" role="presentation">{{ group.label }}</p>
          }
          <div class="nav-group" role="group" [attr.aria-label]="group.label">
            @for (item of group.items; track item.path) {
              <a
                class="nav-link"
                [routerLink]="item.path"
                [class.active]="activeItem() === item.path"
                [attr.aria-current]="activeItem() === item.path ? 'page' : null"
                [title]="item.label"
              >
                <nx-icon [name]="item.icon" />
                @if (!rail()) { <span class="lbl">{{ item.label }}</span> }
              </a>
            }
          </div>
        } @empty {
          <p class="empty">Sin resultados.</p>
        }
      </nav>

      <div class="spacer"></div>

      @if (auth.me(); as me) {
        @if (me.memberships.length > 1 && !rail()) {
          <select class="ws" aria-label="Cambiar de workspace" [value]="me.activeWorkspaceId" (change)="switch($any($event.target).value)">
            @for (m of me.memberships; track m.workspace.id) {
              <option [value]="m.workspace.id">{{ m.workspace.name }}</option>
            }
          </select>
        }
        <div class="user">
          <div class="avatar" [title]="rail() ? me.name : ''">{{ me.name.charAt(0) }}</div>
          @if (!rail()) {
            <div class="who"><strong>{{ me.name }}</strong><small>{{ workspaceName() }}</small></div>
            <a class="btn ghost icon" routerLink="/account" title="Mi cuenta" aria-label="Mi cuenta"><nx-icon name="settings" /></a>
            <button class="btn ghost icon" title="Cerrar sesión" aria-label="Cerrar sesión" (click)="auth.logout()"><nx-icon name="logout" /></button>
          }
        </div>
      }
    </aside>
  `,
  styles: `
    :host { display: contents; }
    /* Colores corporativos NEXO: sidebar en azul profundo; variables --brand-* definidas en styles.scss (con respaldo). */
    .sidebar { width: 248px; background: var(--brand-navy, #08102D); color: #c9d1ec; display: flex; flex-direction: column; padding: 16px 12px; border-right: 1px solid rgba(255, 255, 255, 0.08); position: sticky; top: 0; height: 100vh; flex-shrink: 0; transition: width 0.16s ease; }
    .sidebar.rail { width: 68px; padding: 16px 10px; align-items: stretch; }
    .sidebar::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(120% 40% at 0% 0%, rgba(18, 91, 234, 0.14), transparent 70%); }
    .sidebar > * { position: relative; z-index: 1; }
    .sidebar :focus-visible { outline-color: var(--brand-cyan, #16C7F4); }
    /* Cabecera: marca + botón de plegado. */
    .top { display: flex; align-items: center; gap: 8px; padding: 2px 4px 14px; }
    .brand { display: flex; gap: 10px; align-items: center; color: #fff; border-radius: 10px; min-width: 0; flex: 1; }
    .insignia { width: 34px; height: 34px; flex-shrink: 0; display: block; }
    .wordmark { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .wordmark strong { display: block; font-size: 16px; font-weight: 800; line-height: 1.1; color: #fff; }
    .wordmark small { display: block; font-size: 11px; font-weight: 400; line-height: 1.2; color: #a9b1d6; white-space: nowrap; }
    .collapse { flex-shrink: 0; display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 8px; background: rgba(255, 255, 255, 0.05); color: #a3acd3; cursor: pointer; }
    .collapse:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
    .sidebar.rail .top { flex-direction: column; gap: 10px; padding-bottom: 12px; }
    .sidebar.rail .brand { justify-content: center; flex: none; }
    /* Filtro rápido (solo expandido). */
    .filter { position: relative; display: flex; align-items: center; margin-bottom: 10px; }
    .filter nx-icon { position: absolute; left: 10px; color: #8f98c2; pointer-events: none; }
    .filter input { width: 100%; background: #0e1838; color: #fff; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 9px; padding: 8px 30px 8px 32px; font: inherit; font-size: 13px; }
    .filter input::placeholder { color: #8f98c2; }
    .filter input:focus-visible { border-color: var(--brand-cyan, #16C7F4); outline: none; }
    .filter .clear { position: absolute; right: 6px; display: grid; place-items: center; width: 22px; height: 22px; border: 0; border-radius: 6px; background: transparent; color: #a3acd3; cursor: pointer; }
    .filter .clear:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
    nav { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; overflow-x: hidden; }
    .nav-group { display: flex; flex-direction: column; gap: 2px; }
    /* Etiqueta de sección sutil (no colapsable), estilo moderno: minúscula versalita tenue con separación superior. */
    .section { margin: 12px 12px 4px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #6f78a2; }
    .section:first-of-type { margin-top: 2px; }
    nav a.nav-link { position: relative; display: flex; gap: 11px; align-items: center; padding: 9px 12px; border-radius: 9px; color: #c0c7e3; font-weight: 500; white-space: nowrap; }
    nav a.nav-link .lbl { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    nav a.nav-link:hover { background: rgba(255, 255, 255, 0.06); color: #fff; }
    /* Activo: fondo azul eléctrico translúcido (texto blanco > 12:1) e indicador cian/degradado de marca. */
    nav a.nav-link.active { background: rgba(18, 91, 234, 0.28); color: #fff; box-shadow: inset 0 0 0 1px rgba(22, 199, 244, 0.18); }
    nav a.nav-link.active::before { content: ''; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 0 3px 3px 0; background: var(--brand-gradient, linear-gradient(135deg, #125BEA, #16C7F4, #8550E9)); }
    nav a.nav-link.active nx-icon { color: var(--brand-cyan, #16C7F4); }
    /* Riel plegado: iconos centrados, sin etiquetas. */
    .sidebar.rail nav a.nav-link { justify-content: center; padding: 10px 0; }
    .sidebar.rail .nav-group { align-items: stretch; }
    .empty { color: #8f98c2; font-size: 12.5px; padding: 8px 12px; }
    .spacer { flex: 1; }
    .ws { margin-bottom: 10px; background: #111c45; color: #fff; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; padding: 7px; }
    .user { display: flex; align-items: center; gap: 10px; padding: 10px 6px 0; border-top: 1px solid rgba(255, 255, 255, 0.08); }
    .sidebar.rail .user { justify-content: center; padding: 10px 0 0; }
    .user .btn { color: #c0c7e3; }
    .avatar { width: 32px; height: 32px; border-radius: 50%; background: #16307a; box-shadow: 0 0 0 2px rgba(22, 199, 244, 0.35); color: #fff; display: grid; place-items: center; font-weight: 700; text-transform: uppercase; flex-shrink: 0; }
    .who { flex: 1; min-width: 0; }
    .who strong { display: block; color: #fff; font-size: 13px; }
    .who small { display: block; color: #a3acd3; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* Móvil: la barra pasa a cabecera a lo ancho; la navegación se desplaza en vertical con tope de alto. */
    @media (max-width: 900px) { .sidebar, .sidebar.rail { width: 100%; height: auto; position: relative; border-right: 0; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding: 14px; } .collapse { display: none; } .sidebar.rail .top { flex-direction: row; } nav { max-height: 55vh; } .sidebar.rail nav a.nav-link { justify-content: flex-start; padding: 9px 12px; } .spacer, .user, .ws { display: none; } }
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
  /** `true` cuando el sidebar está plegado a riel de iconos; recordado por visor. */
  protected readonly rail = signal<boolean>(loadRail());

  /** Grupos visibles según el rol: se descartan ítems y grupos que el usuario no puede ver. */
  private readonly visible = computed(() =>
    visibleGroups(NAV_GROUPS, { isAdmin: this.auth.isAdmin(), isPlatformAdmin: !!this.platform.isPlatformAdmin() }),
  );
  /** Grupos finalmente mostrados: los visibles, filtrados por el texto de búsqueda. */
  protected readonly groups = computed(() => filterGroups(this.visible(), this.query()));
  /** `true` si hay una búsqueda activa (oculta las etiquetas de sección para dar una lista plana de coincidencias). */
  protected readonly filtering = computed(() => normalize(this.query()) !== '');
  /** Ruta del ítem activo (coincidencia más específica). */
  protected readonly activeItem = computed(() => activeItemPath(this.visible(), this.url()));

  /** Pliega o despliega el sidebar a riel de iconos y lo recuerda por visor. */
  protected toggleRail(): void {
    const next = !this.rail();
    this.rail.set(next);
    if (next) this.query.set('');
    saveRail(next);
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
