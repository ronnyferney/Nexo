import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { budgetLevel, type BudgetLevel } from './budget';

/**
 * Barra de progreso con color por porcentaje (clases globales `.progress`).
 * - `tone="budget"` (por defecto): consumo de presupuesto; más alto = peor.
 * - `tone="quality"`: puntaje de calidad frente a una meta (`target`, 0–100); alcanzarla = verde. Dibuja la marca de la meta.
 */
@Component({
  selector: 'nx-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="progress {{ level() }}" role="progressbar" [attr.aria-valuenow]="rounded()" aria-valuemin="0" aria-valuemax="100"
      [attr.aria-label]="label() || 'Consumo del presupuesto'">
      <div class="progress-fill" [style.width.%]="width()"></div>
      @if (target() !== null) { <span class="target" [style.left.%]="targetPos()" aria-hidden="true"></span> }
    </div>
  `,
  styles: [
    ':host { display: block; }',
    '.progress { position: relative; }',
    '.target { position: absolute; top: -1px; bottom: -1px; width: 2px; margin-left: -1px; background: var(--text); opacity: 0.55; }',
  ],
})
export class ProgressBarComponent {
  readonly pct = input<number | null>(0);
  readonly label = input('');
  readonly tone = input<'budget' | 'quality'>('budget');
  /** Meta (0–100); solo con `tone="quality"`. */
  readonly target = input<number | null>(null);
  readonly level = computed<BudgetLevel>(() => {
    if (this.tone() === 'budget') return budgetLevel(this.pct());
    const p = this.pct() ?? 0;
    const t = this.target() ?? 85;
    if (p >= t) return 'ok';
    return p >= t * 0.8 ? 'warn' : 'danger';
  });
  readonly width = computed(() => Math.max(0, Math.min(100, this.pct() ?? 0)));
  readonly targetPos = computed(() => Math.max(0, Math.min(100, this.target() ?? 0)));
  readonly rounded = computed(() => Math.round(this.pct() ?? 0));
}
