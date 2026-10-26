import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import type { Evidencia } from '../../core/results.models';

/** Devuelve el enlace (`url`) de la referencia de la evidencia, si lo hay. */
function refUrl(e: Evidencia): string | null {
  const url = (e.referencia as { url?: unknown })?.url;
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
}

/**
 * Lista de evidencias (RF35): REFERENCIA autorizada a la fuente, nunca copia de datos sensibles. Marca si el tipo
 * está entre los exigidos por el contrato (`exigidos`) para dejar claro qué falta para aceptar.
 */
@Component({
  selector: 'nx-evidencias-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RelativeTimePipe, EmptyStateComponent],
  template: `
    @if (evidencias().length) {
      <ul class="ev">
        @for (e of evidencias(); track e.id) {
          <li>
            <span class="badge" [class.success]="exigidos().includes(e.tipo)">{{ e.tipo }}</span>
            <div class="body">
              @if (e.descripcion) {
                <p class="desc">{{ e.descripcion }}</p>
              }
              <div class="meta">
                @if (link(e); as url) {
                  <a [href]="url" target="_blank" rel="noopener noreferrer">
                    <nx-icon name="externalLink" [size]="13" />Ver fuente
                  </a>
                }
                @if (e.hash) {
                  <span class="mono" title="Hash de integridad del registro fuente">#{{ e.hash.slice(0, 10) }}</span>
                }
                <span>{{ e.createdAt | ago }}</span>
              </div>
            </div>
          </li>
        }
      </ul>
    } @else {
      <nx-empty-state icon="file" title="Sin evidencia" description="Aún no se adjuntó evidencia del resultado." />
    }
  `,
  styles: `
    .ev { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .ev li { display: flex; gap: 10px; align-items: flex-start; }
    .body { min-width: 0; flex: 1; }
    .desc { margin: 0 0 4px; font-size: 13.5px; }
    .meta { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; font-size: 12px; color: var(--muted); }
    .meta a { display: inline-flex; align-items: center; gap: 4px; }
    .mono { font-family: ui-monospace, monospace; }
  `,
})
export class EvidenciasListComponent {
  readonly evidencias = input.required<Evidencia[]>();
  /** Tipos de evidencia exigidos por el contrato (para resaltar los satisfechos). */
  readonly exigidos = input<string[]>([]);
  protected link(e: Evidencia): string | null {
    return refUrl(e);
  }
}
