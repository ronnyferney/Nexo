import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent } from '../../shared/icon.component';

/** Estado de configuración de una sección del formulario del agente (RX-7, §4.2). */
export type SectionStatus = 'complete' | 'incomplete' | 'optional' | 'none';

/**
 * Sección identificada de un formulario de configuración: título, descripción breve y un indicador de estado
 * («Completo» / «Falta algo» / «Opcional»). El contenido se proyecta; la jerarquía es plana (una sola tarjeta por
 * sección, sin anidar tarjetas). Presentacional: no toca datos ni guardado.
 */
@Component({
  selector: 'nx-agent-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <section class="cfg-section card">
      <header class="cfg-head">
        <div class="cfg-title">
          @if (icon()) { <nx-icon [name]="icon()" [size]="16" /> }
          <h3 class="m0">{{ title() }}</h3>
          <span class="spacer"></span>
          @switch (status()) {
            @case ('complete') { <span class="badge success" role="status"><nx-icon name="check" [size]="12" />{{ statusLabel() || 'Completo' }}</span> }
            @case ('incomplete') { <span class="badge warning" role="status"><nx-icon name="alert" [size]="12" />{{ statusLabel() || 'Falta algo' }}</span> }
            @case ('optional') { <span class="badge" role="status">{{ statusLabel() || 'Opcional' }}</span> }
          }
        </div>
        @if (description()) { <p class="muted small m0 cfg-desc">{{ description() }}</p> }
      </header>
      <div class="cfg-body stack"><ng-content /></div>
    </section>
  `,
  styles: `
    .cfg-section { display: flex; flex-direction: column; gap: 14px; }
    .cfg-head { display: flex; flex-direction: column; gap: 4px; }
    .cfg-title { display: flex; align-items: center; gap: 8px; }
    .cfg-title h3 { font-size: 14.5px; }
    .cfg-title .badge { gap: 4px; flex: none; }
    .cfg-desc { max-width: 70ch; }
    .m0 { margin: 0; }
    .spacer { flex: 1; }
  `,
})
export class AgentSectionComponent {
  readonly title = input.required<string>();
  readonly description = input('');
  readonly icon = input('');
  readonly status = input<SectionStatus>('none');
  /** Texto a medida del indicador; si se omite, se usa el de cada estado. */
  readonly statusLabel = input('');
  /** Expuesto por si el llamador necesita saber si está "bien" (no usado internamente). */
  readonly ok = computed(() => this.status() === 'complete' || this.status() === 'optional');
}
