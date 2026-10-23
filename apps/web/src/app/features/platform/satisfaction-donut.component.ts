import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const R = 15.915; // circunferencia ≈ 100 para trabajar en porcentajes

/** Dona SVG de satisfacción (👍 frente a 👎), sin librerías. */
@Component({
  selector: 'nx-satisfaction-donut',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 42 42" [attr.width]="size()" [attr.height]="size()" role="img"
      [attr.aria-label]="total() ? 'Satisfacción ' + pct() + ' %: ' + up() + ' positivas y ' + down() + ' negativas' : 'Sin calificaciones'">
      <circle cx="21" cy="21" [attr.r]="r" fill="none" stroke="var(--surface-2)" stroke-width="5" />
      @if (total()) {
        <circle cx="21" cy="21" [attr.r]="r" fill="none" stroke="var(--danger)" stroke-width="5" />
        <circle cx="21" cy="21" [attr.r]="r" fill="none" stroke="var(--success)" stroke-width="5"
          [attr.stroke-dasharray]="pct() + ' ' + (100 - pct())" stroke-dashoffset="25" />
      }
      <text x="21" y="23.5" text-anchor="middle" font-size="8" font-weight="700" fill="currentColor">{{ total() ? pct() + '%' : '—' }}</text>
    </svg>
  `,
  styles: ':host { display: inline-flex; flex-shrink: 0; }',
})
export class SatisfactionDonutComponent {
  readonly up = input(0);
  readonly down = input(0);
  readonly size = input(96);
  readonly r = R;
  readonly total = computed(() => (this.up() ?? 0) + (this.down() ?? 0));
  readonly pct = computed(() => (this.total() ? Math.round((this.up() / this.total()) * 100) : 0));
}
