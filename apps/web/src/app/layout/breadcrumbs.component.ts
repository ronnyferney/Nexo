import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Una miga de pan. Sin `link` se muestra como texto (útil para la página actual). */
export interface Crumb {
  label: string;
  /** Destino de enrutado (`routerLink`). Omítelo para que la miga no sea un enlace. */
  link?: string | unknown[];
}

/**
 * Migas de pan (Breadcrumbs) accesibles: `<nav aria-label="Migas de pan">` con una lista ordenada.
 * La última miga se marca con `aria-current="page"` y nunca es enlace, aunque traiga `link`.
 *
 * Es presentación pura: recibe los ítems ya resueltos; no deriva rutas ni navega por su cuenta.
 *
 * Ejemplo:
 *   <nx-breadcrumbs [items]="[{ label: 'Agentes', link: '/agents' }, { label: 'Ventas' }]" />
 */
@Component({
  selector: 'nx-breadcrumbs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (items().length) {
      <nav class="breadcrumbs" [attr.aria-label]="ariaLabel()">
        <ol>
          @for (crumb of items(); track $index; let last = $last) {
            <li>
              @if (crumb.link && !last) {
                <a [routerLink]="crumb.link">{{ crumb.label }}</a>
              } @else {
                <span [attr.aria-current]="last ? 'page' : null">{{ crumb.label }}</span>
              }
            </li>
          }
        </ol>
      </nav>
    }
  `,
  styles: `
    :host { display: block; }
    ol { list-style: none; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 0; padding: 0; font-size: 12.5px; color: var(--muted); }
    li { display: inline-flex; align-items: center; gap: 4px; }
    /* Separador «/» dibujado por CSS para no depender de un ícono. */
    li:not(:first-child)::before { content: '/'; color: var(--border); }
    a { color: var(--muted); }
    a:hover { color: var(--primary); text-decoration: underline; }
    span[aria-current='page'] { color: var(--text); font-weight: 500; }
  `,
})
export class BreadcrumbsComponent {
  /** Migas en orden (de la raíz a la página actual). */
  readonly items = input<Crumb[]>([]);
  /** Etiqueta accesible del landmark de navegación. */
  readonly ariaLabel = input('Migas de pan');
}
