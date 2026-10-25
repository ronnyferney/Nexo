import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Barra superior (Topbar) reutilizable del «chrome»: landmark `<header role="banner">` fijo en la
 * parte alta del área de contenido, con una zona de título/migas a la izquierda y una de acciones a
 * la derecha. Opcionalmente muestra un botón de menú (hamburguesa) para alternar la navegación en
 * pantallas pequeñas; al pulsarlo emite `menuToggle`.
 *
 * Es presentación pura: no conoce rutas ni estado de sesión. Quien la use decide qué proyectar y
 * cómo reaccionar a `menuToggle`.
 *
 * Slots (`<ng-content>`):
 *  - por defecto: contenido a la izquierda (título, migas, buscador).
 *  - `[actions]`: contenido a la derecha (botones, menú de usuario).
 *
 * Ejemplo:
 *   <nx-topbar [showMenu]="true" (menuToggle)="toggleNav()">
 *     <nx-breadcrumbs [items]="crumbs" />
 *     <button actions class="btn ghost icon" aria-label="Notificaciones">…</button>
 *   </nx-topbar>
 */
@Component({
  selector: 'nx-topbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="topbar" role="banner">
      @if (showMenu()) {
        <button type="button" class="menu-toggle" [attr.aria-label]="menuLabel()" (click)="menuToggle.emit()">
          <span class="bars" aria-hidden="true"></span>
        </button>
      }
      <div class="topbar-start">
        <ng-content />
      </div>
      <div class="topbar-end">
        <ng-content select="[actions]" />
      </div>
    </header>
  `,
  styles: `
    :host { display: block; }
    .topbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 8px 20px; background: color-mix(in srgb, var(--surface) 86%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); }
    .topbar-start { display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1; }
    .topbar-end { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .topbar-end:empty { display: none; }
    /* Hamburguesa dibujada con CSS (sin depender de un ícono del catálogo). */
    .menu-toggle { display: none; width: 36px; height: 36px; padding: 0; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); cursor: pointer; place-items: center; }
    .menu-toggle:hover { background: var(--surface-2); }
    .bars, .bars::before, .bars::after { content: ''; display: block; width: 16px; height: 2px; border-radius: 2px; background: var(--text); }
    .bars { position: relative; margin: auto; }
    .bars::before { position: absolute; top: -5px; }
    .bars::after { position: absolute; top: 5px; }
    @media (max-width: 900px) { .menu-toggle { display: grid; } }
  `,
})
export class TopbarComponent {
  /** Si es `true`, muestra el botón de menú (hamburguesa) en pantallas pequeñas. */
  readonly showMenu = input(false);
  /** Etiqueta accesible del botón de menú. */
  readonly menuLabel = input('Abrir navegación');
  /** Se emite al pulsar el botón de menú. */
  readonly menuToggle = output<void>();
}
