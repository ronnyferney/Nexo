import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { formatScore } from '../../../shared/score.pipe';

export interface ScorePoint {
  id: string;
  label: string;
  score: number;
  date: string;
}

/** Evolución del puntaje por corrida: barras en CSS con la línea de la meta (sin librerías de gráficos). */
@Component({
  selector: 'nx-training-score-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (points().length) {
      <figure class="chart" [attr.aria-label]="summary()">
        <div class="plot">
          <div class="axis" aria-hidden="true"><span>100 %</span><span>50 %</span><span>0 %</span></div>
          <div class="scroll">
            <div class="inner">
              <div class="goal" [style.bottom]="goalBottom()" aria-hidden="true"><span>Meta {{ fmt(target()) }}</span></div>
              <ol class="bars">
                @for (p of points(); track p.id) {
                  <li>
                    <button type="button" class="bar" [class.ok]="p.score >= target()" [class.sel]="p.id === selected()"
                      [attr.aria-label]="p.label + ': ' + fmt(p.score) + ' — ' + p.date + '. Ver detalle'" [attr.aria-pressed]="p.id === selected()"
                      [title]="p.label + ' · ' + fmt(p.score) + ' · ' + p.date" (click)="pick.emit(p.id)">
                      <span class="val">{{ fmt(p.score) }}</span>
                      <span class="fill" [style.height.px]="p.score * 160"></span>
                    </button>
                    <small>{{ p.label }}</small>
                  </li>
                }
              </ol>
            </div>
          </div>
        </div>
        <figcaption class="muted small">Puntaje de cada corrida en orden cronológico; las barras verdes alcanzan la meta. Pulse una barra para ver su detalle.</figcaption>
      </figure>
    }
  `,
  styles: `
    .chart { margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .plot { display: grid; grid-template-columns: 38px minmax(0, 1fr); gap: 6px; }
    .axis { display: flex; flex-direction: column; justify-content: space-between; height: 175px; padding-top: 14px; font-size: 10.5px; color: var(--muted); text-align: right; line-height: 1; }
    .scroll { overflow-x: auto; }
    .inner { position: relative; min-width: min-content; }
    .goal { position: absolute; left: 0; right: 0; border-top: 2px dashed var(--success); z-index: 1; pointer-events: none; }
    .goal span { position: absolute; right: 4px; top: -18px; font-size: 10.5px; font-weight: 650; color: var(--success); background: var(--surface); padding: 0 4px; border-radius: 4px; }
    .bars { list-style: none; margin: 0; padding: 0 6px; display: flex; align-items: flex-end; gap: 6px; border-left: 1px solid var(--border); }
    .bars li { flex: 1 0 36px; max-width: 64px; display: flex; flex-direction: column; }
    .bar { height: 174px; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; border: 0; border-bottom: 1px solid var(--border); background: none; padding: 0; cursor: pointer; font: inherit; color: var(--muted); }
    .fill { display: block; width: 100%; max-height: 160px; min-height: 2px; border-radius: 4px 4px 0 0; background: var(--primary); opacity: 0.85; }
    .bar.ok .fill { background: var(--success); }
    .bar:hover .fill, .bar.sel .fill { opacity: 1; outline: 2px solid var(--primary); outline-offset: 1px; }
    .val { font-size: 10.5px; font-weight: 650; font-variant-numeric: tabular-nums; margin-bottom: 2px; }
    .bars small { font-size: 10.5px; color: var(--muted); text-align: center; white-space: nowrap; height: 20px; line-height: 20px; }
  `,
})
export class TrainingScoreChartComponent {
  readonly points = input<ScorePoint[]>([]);
  /** Meta 0–1. */
  readonly target = input(0.85);
  readonly selected = input<string | null>(null);
  readonly pick = output<string>();
  /** La barra mide 160 px de alto sobre la etiqueta (20 px) y el borde inferior. */
  readonly goalBottom = computed(() => `${21 + Math.max(0, Math.min(1, this.target())) * 160}px`);
  readonly summary = computed(() => {
    const p = this.points();
    const last = p.at(-1);
    return `Evolución del puntaje en ${p.length} corridas; última ${last ? formatScore(last.score) : '—'}, meta ${formatScore(this.target())}`;
  });

  fmt(v: number) {
    return formatScore(v);
  }
}
