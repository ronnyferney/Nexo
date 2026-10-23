import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ProviderInfo } from '../../../core/models';
import { TIER_LABELS } from '../../../shared/budget';
import { formatUsd } from '../../../shared/usd.pipe';
import { modelKey } from './training-utils';

/** Selector de modelo del catálogo (`"<providerId>:<modelId>"`) agrupado por proveedor, con nivel y precio. */
@Component({
  selector: 'nx-model-select',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <select class="input" [id]="selectId()" [disabled]="disabled() || !groups().length" [ngModel]="value()" (ngModelChange)="value.set($event)">
      @if (!groups().length) { <option value="">No hay modelos configurados</option> }
      @for (g of groups(); track g.id) {
        <optgroup [label]="g.label">
          @for (m of g.models; track m.key) { <option [value]="m.key">{{ m.text }}</option> }
        </optgroup>
      }
    </select>
  `,
  styles: [':host { display: block; min-width: 0; }'],
})
export class ModelSelectComponent {
  readonly providers = input<ProviderInfo[]>([]);
  readonly selectId = input.required<string>();
  readonly disabled = input(false);
  readonly value = model('');
  readonly groups = computed(() =>
    this.providers()
      .filter((p) => p.configured && p.models.length)
      .map((p) => ({
        id: p.id,
        label: p.label,
        models: p.models.map((m) => ({
          key: modelKey(p.id, m.id),
          text: `${m.label} · ${TIER_LABELS[m.tier]} · ${formatUsd(m.inputUsdPerMTok)} / ${formatUsd(m.outputUsdPerMTok)} por MTok`,
        })),
      })),
  );
}
