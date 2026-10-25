import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { BreadcrumbsComponent, type Crumb } from './breadcrumbs.component';

/**
 * Encabezado de página (PageHeader) estándar: migas opcionales, título (`<h1>`), descripción y
 * zonas de contenido proyectado para un elemento inicial (botón volver, icono) y para acciones.
 *
 * Reutiliza la clase global `.page-header` de `styles.scss`, de modo que las páginas que aún usan
 * ese patrón a mano y las que adopten este componente comparten exactamente la misma maqueta.
 *
 * Slots (`<ng-content>`):
 *  - `[lead]`    elemento a la izquierda del título (p. ej. un botón «volver» o un icono).
 *  - `[meta]`    contenido bajo el título/descripción (badges, metadatos).
 *  - `[actions]` acciones a la derecha (botones).
 *
 * Ejemplo:
 *   <nx-page-header heading="Skills" description="Habilidades reutilizables"
 *     [crumbs]="[{ label: 'Portal', link: '/' }, { label: 'Skills' }]">
 *     <button actions class="btn primary">Nueva skill</button>
 *   </nx-page-header>
 */
@Component({
  selector: 'nx-page-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BreadcrumbsComponent],
  template: `
    <div class="page-header-wrap">
      @if (crumbs().length) {
        <nx-breadcrumbs [items]="crumbs()" />
      }
      <header class="page-header">
        <div class="ph-title">
          <ng-content select="[lead]" />
          <div class="ph-text">
            <h1>{{ heading() }}</h1>
            @if (description()) {
              <p>{{ description() }}</p>
            }
            <ng-content select="[meta]" />
          </div>
        </div>
        <div class="ph-actions">
          <ng-content select="[actions]" />
        </div>
      </header>
    </div>
  `,
  styles: `
    :host { display: block; }
    nx-breadcrumbs { display: block; margin-bottom: 8px; }
    .ph-title { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .ph-text { min-width: 0; }
    .ph-actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
    .ph-actions:empty { display: none; }
  `,
})
export class PageHeaderComponent {
  /** Título principal de la página. */
  readonly heading = input.required<string>();
  /** Texto descriptivo opcional bajo el título. */
  readonly description = input('');
  /** Migas de pan opcionales; si trae ítems se muestran sobre el título. */
  readonly crumbs = input<Crumb[]>([]);
}
