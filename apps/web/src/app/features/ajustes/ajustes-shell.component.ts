import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { PlatformApi } from '../../core/platform.api';
import { IconComponent } from '../../shared/icon.component';
import { normalize } from '../../layout/sidebar.util';

type Scope = 'all' | 'admin' | 'platform';
interface SettingItem {
  icon: string;
  label: string;
  /** Ruta relativa a /ajustes (p. ej. «conectores» → /ajustes/conectores). */
  path: string;
  scope: Scope;
}
interface SettingGroup {
  title: string;
  items: SettingItem[];
}

/**
 * Catálogo de ajustes agrupado. Cada ítem apunta a una ruta hija de /ajustes que reutiliza la página de
 * configuración ya existente; así el detalle se abre dentro de este espacio sin duplicar componentes.
 */
export const AJUSTES_GROUPS: readonly SettingGroup[] = [
  {
    title: 'Conexiones y canales',
    items: [
      { icon: 'plug', label: 'Conectores', path: 'conectores', scope: 'all' },
      { icon: 'send', label: 'Canales externos', path: 'canales-externos', scope: 'admin' },
      { icon: 'headset', label: 'Voz', path: 'voz', scope: 'admin' },
      { icon: 'server', label: 'Estaciones virtuales', path: 'estaciones-virtuales', scope: 'admin' },
      { icon: 'server', label: 'Nexo Edge', path: 'edges', scope: 'admin' },
    ],
  },
  {
    title: 'Organización',
    items: [
      { icon: 'building', label: 'Organización', path: 'organizacion', scope: 'admin' },
      { icon: 'subunit', label: 'Estructura', path: 'estructura', scope: 'admin' },
      { icon: 'hash', label: 'Dimensiones', path: 'dimensiones', scope: 'admin' },
      { icon: 'users', label: 'Grupos', path: 'grupos', scope: 'admin' },
    ],
  },
  {
    title: 'Workspace y seguridad',
    items: [
      { icon: 'settings', label: 'Ajustes generales', path: 'generales', scope: 'admin' },
      { icon: 'shield', label: 'Seguridad', path: 'seguridad', scope: 'admin' },
      { icon: 'lock', label: 'Auditoría', path: 'auditoria', scope: 'admin' },
    ],
  },
  {
    title: 'Economía',
    items: [
      { icon: 'wallet', label: 'Presupuestos', path: 'presupuestos', scope: 'admin' },
      { icon: 'scale', label: 'Imputación de costos', path: 'imputacion', scope: 'admin' },
    ],
  },
  {
    title: 'Plataforma Nexo',
    items: [
      { icon: 'trophy', label: 'Éxito de clientes', path: 'exito-clientes', scope: 'platform' },
      { icon: 'sparkles', label: 'Calidad del Copilot', path: 'calidad-copilot', scope: 'platform' },
      { icon: 'plug', label: 'Apps de inicio de sesión', path: 'apps-login', scope: 'platform' },
    ],
  },
];

/**
 * Espacio de Ajustes al estilo del ejemplo de referencia: una barra lateral propia con buscador y secciones
 * (iconos + nombre, con la activa resaltada) y, a la derecha, el detalle de la opción seleccionada en un
 * «router-outlet». Reúne «el resto de la configuración» sin cambiar permisos: cada ítem se filtra por rol.
 */
@Component({
  selector: 'nx-ajustes-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ajustes">
      <aside class="s-nav" aria-label="Ajustes">
        <div class="s-top">
          <a class="back" routerLink="/" aria-label="Volver al inicio"><nx-icon name="arrowLeft" [size]="18" /></a>
          <span class="s-title">Ajustes</span>
        </div>

        <label class="s-search">
          <nx-icon name="search" [size]="16" />
          <input type="search" [value]="query()" (input)="onSearch($event)" placeholder="Buscar en ajustes"
            aria-label="Buscar en ajustes" />
        </label>

        <nav class="s-groups" aria-label="Secciones de configuración">
          @for (g of groups(); track g.title) {
            <div class="s-group">
              <h2 class="s-group-title">{{ g.title }}</h2>
              @for (it of g.items; track it.path) {
                <a class="s-item" [routerLink]="it.path" routerLinkActive="active">
                  <nx-icon [name]="it.icon" [size]="18" />
                  <span>{{ it.label }}</span>
                </a>
              }
            </div>
          } @empty {
            <p class="muted small empty">Sin coincidencias.</p>
          }
        </nav>
      </aside>

      <section class="s-body"><router-outlet /></section>
    </div>
  `,
  styles: `
    /* Barra de Ajustes como columna a ras (mismo encaje que los demás menús): azul oscuro corporativo —igual que
       el submenú del menú lateral—, ancho 236px, altura completa bajo el toolbar y sin tarjeta flotante. */
    .ajustes { display: grid; grid-template-columns: 236px 1fr; align-items: start; }
    .s-nav {
      position: sticky; top: 56px; height: calc(100vh - 56px); overflow-y: auto;
      display: flex; flex-direction: column; gap: 14px;
      background: #0b1430; color: #c9d1ec; border-right: 1px solid rgba(255, 255, 255, 0.08); padding: 16px 14px;
    }
    .s-nav :focus-visible { outline-color: var(--brand-cyan, #16C7F4); }
    .s-top { display: flex; align-items: center; gap: 10px; }
    .back {
      display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 8px;
      color: #a3acd3; text-decoration: none;
    }
    .back:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
    .s-title { font-size: 18px; font-weight: 800; color: #fff; }
    .s-search {
      display: flex; align-items: center; gap: 8px; padding: 0 10px; height: 38px;
      background: #0e1838; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 10px; color: #8f98c2;
    }
    .s-search:focus-within { border-color: var(--brand-cyan, #16C7F4); }
    .s-search input { flex: 1; border: 0; background: transparent; outline: none; color: #fff; font-size: 13.5px; }
    .s-search input::placeholder { color: #8f98c2; }
    .s-groups { display: flex; flex-direction: column; gap: 14px; }
    .s-group { display: flex; flex-direction: column; gap: 2px; }
    .s-group-title {
      font-size: 11px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
      color: #8f98c2; margin: 2px 0 6px; padding: 0 8px;
    }
    .s-item {
      display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 9px;
      color: #c0c7e3; text-decoration: none; font-size: 13.5px; font-weight: 600; line-height: 1.2;
    }
    .s-item nx-icon { color: #aeb6da; flex-shrink: 0; }
    .s-item:hover { background: rgba(255, 255, 255, 0.06); color: #fff; }
    .s-item.active { background: rgba(18, 91, 234, 0.28); color: #fff; box-shadow: inset 0 0 0 1px rgba(22, 199, 244, 0.18); }
    .s-item.active nx-icon { color: var(--brand-cyan, #16C7F4); }
    .empty { padding: 6px 8px; color: #8f98c2; }
    .s-body { min-width: 0; }

    @media (max-width: 920px) {
      .ajustes { grid-template-columns: 1fr; }
      .s-nav { position: static; height: auto; border-right: 0; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
    }
  `,
})
export class AjustesShellComponent {
  private readonly auth = inject(AuthService);
  private readonly platform = inject(PlatformApi);

  protected readonly query = signal('');

  /** Grupos visibles según rol y filtro de búsqueda; se descartan ítems y grupos vacíos. */
  protected readonly groups = computed<SettingGroup[]>(() => {
    const isAdmin = this.auth.isAdmin();
    const isPlatform = !!this.platform.isPlatformAdmin();
    const can = (s: Scope) => s === 'all' || (s === 'admin' && isAdmin) || (s === 'platform' && isPlatform);
    const q = normalize(this.query());
    return AJUSTES_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((it) => can(it.scope) && (!q || normalize(it.label).includes(q))),
    })).filter((g) => g.items.length > 0);
  });

  protected onSearch(ev: Event): void {
    this.query.set((ev.target as HTMLInputElement).value);
  }
}
