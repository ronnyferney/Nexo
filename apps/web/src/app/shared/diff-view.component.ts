import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { type DiffLine, diffLines, diffStats } from './line-diff';

type Row = { type: 'line'; line: DiffLine } | { type: 'gap'; count: number };

/** Líneas sin cambios que se muestran alrededor de cada cambio cuando el diff está compacto. */
const CONTEXT = 2;

/** Diff por líneas legible: resalta líneas agregadas (+) y eliminadas (−) y compacta el contexto sin cambios. */
@Component({
  selector: 'nx-diff',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="diff-head">
      @if (label()) { <strong class="small">{{ label() }}</strong> }
      <span class="small add-c">+{{ stats().added }}</span>
      <span class="small del-c">−{{ stats().removed }}</span>
      <span class="spacer"></span>
      @if (hasGaps() || expanded()) {
        <button type="button" class="btn ghost sm" [attr.aria-pressed]="expanded()" (click)="expanded.set(!expanded())">
          {{ expanded() ? 'Compactar' : 'Ver todo' }}
        </button>
      }
    </div>
    @if (!stats().added && !stats().removed) {
      <p class="muted small none">Sin cambios.</p>
    } @else {
      <div class="diff" role="table" [attr.aria-label]="label() || 'Comparación de cambios'">
        @for (r of rows(); track $index) {
          @if (r.type === 'gap') {
            <div class="gap" role="row"><span role="cell">… {{ r.count }} {{ r.count === 1 ? 'línea' : 'líneas' }} sin cambios</span></div>
          } @else {
            <div class="ln {{ r.line.kind }}" role="row">
              <span class="no" role="cell" aria-hidden="true">{{ r.line.oldNo ?? '' }}</span>
              <span class="no" role="cell" aria-hidden="true">{{ r.line.newNo ?? '' }}</span>
              <span class="sign" role="cell">
                @switch (r.line.kind) {
                  @case ('add') { <span aria-hidden="true">+</span><span class="vh">Agregada:</span> }
                  @case ('del') { <span aria-hidden="true">−</span><span class="vh">Eliminada:</span> }
                }
              </span>
              <span class="txt" role="cell">{{ r.line.text || ' ' }}</span>
            </div>
          }
        }
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .diff-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .add-c { color: var(--success); font-weight: 650; }
    .del-c { color: var(--danger); font-weight: 650; }
    .none { margin: 0; }
    .diff { border: 1px solid var(--border); border-radius: 9px; overflow: auto; max-height: 420px; font-family: var(--mono); font-size: 12px; line-height: 1.55; background: var(--surface); }
    .ln { display: grid; grid-template-columns: 34px 34px 18px minmax(0, 1fr); min-width: 0; }
    .no { color: var(--muted); text-align: right; padding: 0 6px 0 0; user-select: none; font-variant-numeric: tabular-nums; opacity: 0.75; }
    .sign { text-align: center; font-weight: 700; user-select: none; }
    .txt { white-space: pre-wrap; word-break: break-word; padding-right: 8px; }
    .ln.add { background: var(--success-50); }
    .ln.add .sign { color: var(--success); }
    .ln.del { background: var(--danger-50); }
    .ln.del .sign { color: var(--danger); }
    .ln.del .txt { text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--danger) 45%, transparent); }
    .gap { padding: 2px 10px; color: var(--muted); background: var(--surface-2); font-family: var(--font); font-size: 11.5px; }
    .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
    @media (max-width: 480px) { .ln { grid-template-columns: 0 26px 16px minmax(0, 1fr); } .ln .no:first-child { visibility: hidden; } }
  `,
})
export class DiffViewComponent {
  readonly before = input('');
  readonly after = input('');
  readonly label = input('');
  readonly expanded = signal(false);

  readonly lines = computed(() => diffLines(this.before() ?? '', this.after() ?? ''));
  readonly stats = computed(() => diffStats(this.lines()));
  private readonly compact = computed(() => compactRows(this.lines()));
  readonly hasGaps = computed(() => this.compact().some((r) => r.type === 'gap'));
  readonly rows = computed<Row[]>(() =>
    this.expanded() ? this.lines().map((line) => ({ type: 'line', line })) : this.compact(),
  );
}

/** Oculta los tramos sin cambios lejos de cualquier cambio, dejando `CONTEXT` líneas a cada lado. */
function compactRows(lines: DiffLine[]): Row[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.kind === 'same') return;
    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(lines.length - 1, i + CONTEXT); k++) keep[k] = true;
  });
  const rows: Row[] = [];
  let hidden = 0;
  lines.forEach((line, i) => {
    if (keep[i]) {
      if (hidden) rows.push({ type: 'gap', count: hidden });
      hidden = 0;
      rows.push({ type: 'line', line });
    } else hidden++;
  });
  if (hidden) rows.push({ type: 'gap', count: hidden });
  return rows;
}
