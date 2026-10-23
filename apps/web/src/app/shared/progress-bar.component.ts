import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { budgetLevel } from './budget';

/** Barra de progreso de presupuesto con color por porcentaje (clases globales `.progress`). */
@Component({
  selector: 'nx-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="progress {{ level() }}" role="progressbar" [attr.aria-valuenow]="rounded()" aria-valuemin="0" aria-valuemax="100"
      [attr.aria-label]="label() || 'Consumo del presupuesto'">
      <div class="progress-fill" [style.width.%]="width()"></div>
    </div>
  `,
  styles: [':host { display: block; }'],
})
export class ProgressBarComponent {
  readonly pct = input<number | null>(0);
  readonly label = input('');
  readonly level = computed(() => budgetLevel(this.pct()));
  readonly width = computed(() => Math.max(0, Math.min(100, this.pct() ?? 0)));
  readonly rounded = computed(() => Math.round(this.pct() ?? 0));
}
