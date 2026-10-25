import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
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
 *  - `[meta]`    contenido bajo el título/descripción (badges, metadatos, descripción con markup).
 *                Úsalo cuando la descripción no sea un simple string; el input `description`
 *                sigue funcionando igual y ambos pueden convivir.
 *  - `[actions]` acciones a la derecha (botones, barra de búsqueda).
 *
 * Variantes (`hostClass`): clases extra que se añaden al `<header class="page-header">` para
 * habilitar variantes visuales sin romper el patrón base. Valores usados hoy:
 *  - `brand-hero` encabezado «hero» con gradiente de marca (ver `styles.scss`), p. ej. el inicio.
 *  - `in-card`    encabezado dentro de una tarjeta/panel: menor margen inferior, alineado arriba y
 *                 zona de acciones que crece (barra de búsqueda a lo ancho), p. ej. Integraciones.
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
      <header [class]="headerClass()">
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

    /* Variante «in-card»: encabezado dentro de una tarjeta (p. ej. galería de Integraciones). */
    .page-header.in-card { align-items: flex-start; margin-bottom: 8px; gap: 16px 24px; }
    .page-header.in-card .ph-actions { flex: 1 1 auto; justify-content: flex-end; }
    @media (max-width: 560px) {
      .page-header.in-card { padding: 0 4px; }
    }
  `,
})
export class PageHeaderComponent {
  /** Título principal de la página. */
  readonly heading = input.required<string>();
  /** Texto descriptivo opcional bajo el título. */
  readonly description = input('');
  /** Migas de pan opcionales; si trae ítems se muestran sobre el título. */
  readonly crumbs = input<Crumb[]>([]);
  /** Clases extra para el `<header>`, habilitan variantes como `brand-hero` o `in-card`. */
  readonly hostClass = input('');

  /** Clase base `.page-header` más las variantes opcionales de `hostClass`. */
  protected readonly headerClass = computed(() => {
    const extra = this.hostClass().trim();
    return extra ? `page-header ${extra}` : 'page-header';
  });
}
