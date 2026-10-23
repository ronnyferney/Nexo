import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { SqlQueryResult } from '../../core/integrations.models';
import { IconComponent } from '../../shared/icon.component';

const MAX_RENDERED = 200;

/** Resultado de una consulta SQL en forma de tabla (columnas de `fields`). */
@Component({
  selector: 'nx-query-result-table',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let r = result();
    <div class="row wrap small muted">
      <span><strong>{{ r.rowCount ?? r.rows.length }}</strong> {{ (r.rowCount ?? r.rows.length) === 1 ? 'fila' : 'filas' }} · {{ columns().length }} columnas</span>
      @if (durationMs() !== null) { <span>· {{ durationMs() }} ms</span> }
    </div>
    @if (r.truncated) {
      <div class="callout warning" role="status"><nx-icon name="alert" [size]="16" />
        <span>El resultado se truncó al máximo de filas de la operación. Filtre la consulta o aumente «Máximo de filas».</span></div>
    }
    @if (!r.rows.length) {
      <p class="muted small">La consulta no devolvió filas.</p>
    } @else {
      <div class="table-wrap scroll" tabindex="0" role="region" aria-label="Resultados de la consulta">
        <table class="table">
          <thead><tr>@for (col of columns(); track col) { <th scope="col" class="mono">{{ col }}</th> }</tr></thead>
          <tbody>
            @for (row of visibleRows(); track $index) {
              <tr>@for (col of columns(); track col) {
                @let v = row[col];
                <td [class.null]="v === null || v === undefined">{{ cell(v) }}</td>
              }</tr>
            }
          </tbody>
        </table>
      </div>
      @if (r.rows.length > maxRendered) { <p class="muted small">Se muestran las primeras {{ maxRendered }} filas de {{ r.rows.length }}.</p> }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 8px; }
    .scroll { max-height: 360px; overflow: auto; border: 1px solid var(--border); border-radius: 9px; }
    .table th { position: sticky; top: 0; background: var(--surface); white-space: nowrap; }
    .table td { padding: 7px 12px; font-family: var(--mono); font-size: 12px; white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
    .table td.null { color: var(--muted); font-style: italic; }
  `,
})
export class QueryResultTableComponent {
  readonly result = input.required<SqlQueryResult>();
  readonly durationMs = input<number | null>(null);
  readonly maxRendered = MAX_RENDERED;

  readonly columns = computed(() => {
    const r = this.result();
    if (r.fields?.length) return r.fields.map((f) => (typeof f === 'string' ? f : f.name));
    const keys: string[] = [];
    for (const row of r.rows.slice(0, 50)) for (const k of Object.keys(row)) if (!keys.includes(k)) keys.push(k);
    return keys;
  });
  readonly visibleRows = computed(() => this.result().rows.slice(0, MAX_RENDERED));

  cell(v: unknown): string {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
}
