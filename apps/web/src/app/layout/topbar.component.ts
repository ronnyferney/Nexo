import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { PlatformApi } from '../core/platform.api';
import { IconComponent } from '../shared/icon.component';
import { LayoutService } from './layout.service';
import { filterGroups, NAV_GROUPS, titleForUrl, visibleGroups } from './sidebar.util';

/**
 * Toolbar superior persistente (patrón tipo Fireflies), con los colores corporativos de NEXO:
 *  - Izquierda: botón para colapsar/mostrar el panel secundario del menú + título de la sección activa.
 *  - Centro: buscador global del menú (al pulsar Enter navega a la mejor coincidencia).
 *  - Derecha: menú de usuario (nombre+correo, organizaciones, perfil, administración, cerrar sesión).
 *
 * El menú de usuario vive aquí (no al pie del riel) para no solaparse con la barra lateral de Ajustes.
 * Presentación pura sobre la sesión y la URL; no cambia rutas ni permisos.
 */
@Component({
  selector: 'nx-topbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    <header class="topbar">
      <div class="left">
        <button
          type="button"
          class="t-toggle"
          [attr.aria-label]="layout.panelHidden() ? 'Mostrar el panel' : 'Ocultar el panel'"
          [title]="layout.panelHidden() ? 'Mostrar el panel' : 'Ocultar el panel'"
          (click)="layout.togglePanel()"
        >
          <nx-icon name="sidebarToggle" [size]="17" />
        </button>
        <span class="t-title">{{ title() }}</span>
      </div>

      <form class="t-search" role="search" (submit)="submitSearch($event)">
        <nx-icon name="search" [size]="16" aria-hidden="true" />
        <input
          type="search"
          [value]="query()"
          (input)="query.set($any($event.target).value)"
          placeholder="Buscar en Nexo…"
          aria-label="Buscar en Nexo"
        />
      </form>

      <div class="right">
        @if (auth.me(); as me) {
          <button
            type="button"
            class="t-user"
            aria-haspopup="menu"
            [attr.aria-expanded]="userOpen()"
            [attr.aria-label]="'Menú de usuario: ' + me.name"
            (click)="toggleUser()"
          >
            <span class="avatar">{{ me.name.charAt(0) }}</span>
            <span class="who">{{ me.name }}</span>
            <nx-icon name="chevronDown" [size]="15" />
          </button>

          @if (userOpen()) {
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
        }
      </div>
    </header>
  `,
  styles: `
    :host { display: block; position: sticky; top: 0; z-index: 30; }
    .topbar {
      display: flex; align-items: center; gap: 16px; height: 56px; padding: 0 16px;
      background: var(--surface, #fff); border-bottom: 1px solid var(--border, #e6e8f0);
    }
    .left { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .t-toggle {
      display: grid; place-items: center; width: 34px; height: 34px; border: 0; border-radius: 9px;
      background: transparent; color: var(--text-muted, #8f98c2); cursor: pointer; flex-shrink: 0;
    }
    .t-toggle:hover { background: var(--surface-2, #f2f4fb); color: var(--text); }
    .t-title { font-size: 16px; font-weight: 700; color: var(--text); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .t-search {
      flex: 1; max-width: 520px; margin: 0 auto; display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 12px;
      background: var(--surface-2, #f2f4fb); border: 1px solid var(--border, #e6e8f0); border-radius: 10px;
      color: var(--text-muted, #8f98c2);
    }
    .t-search:focus-within { border-color: var(--brand-cyan, #16C7F4); }
    .t-search input { flex: 1; border: 0; background: transparent; outline: none; color: var(--text); font: inherit; font-size: 13.5px; }

    .right { display: flex; align-items: center; gap: 8px; position: relative; }
    .t-user {
      display: flex; align-items: center; gap: 9px; height: 40px; padding: 0 10px 0 6px; border: 1px solid var(--border, #e6e8f0);
      border-radius: 999px; background: var(--surface, #fff); color: var(--text); cursor: pointer; max-width: 220px;
    }
    .t-user:hover { background: var(--surface-2, #f2f4fb); }
    .t-user .avatar {
      width: 30px; height: 30px; border-radius: 50%; background: var(--brand-navy, #08102D); color: #fff;
      display: grid; place-items: center; font-weight: 700; text-transform: uppercase; font-size: 12.5px; flex-shrink: 0;
    }
    .t-user .who { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .t-user nx-icon { color: var(--text-muted, #8f98c2); flex-shrink: 0; }

    .backdrop { position: fixed; inset: 0; z-index: 40; }
    .user-menu {
      position: absolute; right: 0; top: calc(100% + 8px); z-index: 41; width: 250px;
      background: var(--surface, #fff); color: var(--text); border: 1px solid var(--border, #e6e8f0); border-radius: 12px;
      padding: 10px; box-shadow: 0 18px 50px rgba(8, 16, 45, 0.18); display: flex; flex-direction: column; gap: 4px;
    }
    .u-head { padding: 4px 10px 10px; min-width: 0; }
    .u-head strong { display: block; color: var(--text); font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .u-head small { display: block; color: var(--text-muted, #8f98c2); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .u-sec { display: flex; flex-direction: column; gap: 2px; padding: 6px 0; border-top: 1px solid var(--border, #e6e8f0); }
    .u-item { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border: 0; border-radius: 8px; background: transparent; color: var(--text); font: inherit; font-size: 13px; text-align: left; cursor: pointer; width: 100%; text-decoration: none; }
    .u-item nx-icon { color: var(--text-muted, #8f98c2); flex-shrink: 0; }
    .u-item:hover { background: var(--surface-2, #f2f4fb); }
    .u-item[aria-checked='true'] nx-icon { color: var(--brand-cyan, #16C7F4); }
    .u-item.danger { color: #c0334a; }
    .u-item.danger:hover { background: rgba(224, 49, 79, 0.1); }
    .u-item.danger nx-icon { color: #c0334a; }

    @media (max-width: 720px) {
      .t-search { display: none; }
      .t-user .who { display: none; }
    }
  `,
})
export class TopbarComponent {
  protected readonly auth = inject(AuthService);
  protected readonly platform = inject(PlatformApi);
  protected readonly layout = inject(LayoutService);
  private readonly router = inject(Router);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  protected readonly title = computed(() => titleForUrl(NAV_GROUPS, this.url()));

  protected readonly query = signal('');
  protected readonly userOpen = signal(false);

  /** Al enviar la búsqueda, navega a la mejor coincidencia visible del menú (si la hay). */
  protected submitSearch(ev: Event): void {
    ev.preventDefault();
    const vis = { isAdmin: this.auth.isAdmin(), isPlatformAdmin: !!this.platform.isPlatformAdmin() };
    const matches = filterGroups(visibleGroups(NAV_GROUPS, vis), this.query()).flatMap((g) => g.items);
    const first = matches[0];
    if (first) {
      this.query.set('');
      void this.router.navigateByUrl(first.path);
    }
  }

  protected toggleUser(): void {
    this.userOpen.update((v) => !v);
  }
  protected closeUser(): void {
    this.userOpen.set(false);
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
