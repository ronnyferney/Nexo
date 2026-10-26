import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/api.service';
import { DimensionesApi } from '../../../core/dimensiones.api';
import type { AnalisisResult, Dimension } from '../../../core/dimensiones.models';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { IconComponent } from '../../../shared/icon.component';
import { LoadingStateComponent } from '../../../shared/loading-state.component';
import { DateRangeComponent, lastDays, rangeToIso, type DateRange } from '../../../shared/date-range.component';
import { formatUsd, NumberPipe, UsdPipe } from '../../../shared/usd.pipe';
import { barraPorcentaje, porcentajeDelTotal, tipoValorLabel } from './dimensiones.util';

/**
 * Consola de análisis (ADR 0011 D7/D8): pivota el consumo por CUALQUIER dimensión configurada (no cableada a
 * línea/sede). Selector dinámico de dimensión + rango de fechas; tabla y gráfico de barras (SVG inline) del consumo por
 * valor, con el total. Solo lectura; no inventa datos (empty-state si no hay consumo etiquetado en el rango).
 */
@Component({
  selector: 'nx-consola-analisis',
  imports: [
    FormsModule,
    IconComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    LoadingStateComponent,
    DateRangeComponent,
    UsdPipe,
    NumberPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row wrap" style="margin-bottom:16px; align-items:flex-end; gap:16px">
      <div class="field" style="min-width:240px">
        <label for="an-dim">Dimensión (agrupar por)</label>
        <select id="an-dim" class="input" [ngModel]="groupBy()" (ngModelChange)="setGroupBy($event)">
          @if (!dimensiones().length) { <option value="">— Sin dimensiones —</option> }
          @for (d of dimensiones(); track d.id) { <option [value]="d.codigo">{{ d.nombre }} ({{ d.codigo }})</option> }
        </select>
      </div>
      <div class="field">
        <label>Rango de fechas</label>
        <nx-date-range [(range)]="range" (rangeChange)="onRange()" />
      </div>
      <span class="spacer"></span>
      <button class="btn" style="align-self:flex-end" (click)="load()" [disabled]="loading() || !groupBy()">
        <nx-icon name="refresh" [size]="15" />Actualizar
      </button>
    </div>

    @if (!dimensiones().length) {
      <nx-empty-state icon="layers" title="Sin dimensiones configuradas"
        description="Define una dimensión en la pestaña Dimensiones para poder pivotar el consumo por ella." />
    } @else if (loading()) {
      <nx-loading-state text="Calculando el análisis…" />
    } @else if (error()) {
      <nx-error-state title="No se pudo cargar el análisis" message="{{ error() }}" (retry)="load()" />
    } @else if (result(); as r) {
      <div class="kpis" style="margin-bottom:16px">
        <div class="card kpi-card">
          <div class="icon-tile"><nx-icon name="wallet" /></div>
          <div><div class="muted small">Costo total</div><div class="kpi-value">{{ fmtUsd(r.totalCostUsd) }}</div></div>
        </div>
        <div class="card kpi-card">
          <div class="icon-tile"><nx-icon name="zap" /></div>
          <div><div class="muted small">Llamadas</div><div class="kpi-value">{{ r.calls | num }}</div></div>
        </div>
        <div class="card kpi-card">
          <div class="icon-tile"><nx-icon name="layers" /></div>
          <div><div class="muted small">Dimensión</div><div class="kpi-value" style="font-size:18px">{{ r.dimension.nombre }}</div>
            <div class="muted small">{{ tipoValorLabel(r.dimension.tipoValor) }}</div></div>
        </div>
      </div>

      @if (!r.groups.length || r.totalCostUsd === 0) {
        <nx-empty-state icon="chart" title="Sin consumo etiquetado"
          description="No hay consumo registrado en este rango, o aún no se ha etiquetado con esta dimensión." />
      } @else {
        <div class="card">
          <div class="card-title">
            <h2>Consumo por {{ r.dimension.nombre }}</h2>
            <span class="spacer"></span>
            <span class="muted small">{{ fecha(r.from) }} – {{ fecha(r.to) }}</span>
          </div>

          <div class="chart" role="img" [attr.aria-label]="chartAria(r)">
            @for (g of r.groups; track g.key) {
              <div class="bar-row">
                <div class="bar-label" [title]="g.label">{{ g.label }}</div>
                <svg class="bar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
                  <rect x="0" y="2" width="100" height="6" rx="1" class="bar-track" />
                  <rect x="0" y="2" [attr.width]="pct(g.costUsd)" height="6" rx="1" class="bar-fill" />
                </svg>
                <div class="bar-val">{{ g.costUsd | usd }}<span class="muted small"> · {{ pctTotal(g.costUsd, r.totalCostUsd) }}%</span></div>
              </div>
            }
          </div>

          <div class="divider"></div>

          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>{{ r.dimension.nombre }}</th><th class="num">Costo</th><th class="num">% del total</th><th class="num">Llamadas</th></tr></thead>
              <tbody>
                @for (g of r.groups; track g.key) {
                  <tr>
                    <td><strong>{{ g.label }}</strong>@if (g.key) { <div class="muted small mono">{{ g.key }}</div> }</td>
                    <td class="num">{{ g.costUsd | usd }}</td>
                    <td class="num">{{ pctTotal(g.costUsd, r.totalCostUsd) }}%</td>
                    <td class="num">{{ g.calls | num }}</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr><td><strong>Total</strong></td><td class="num"><strong>{{ r.totalCostUsd | usd }}</strong></td><td class="num">100%</td><td class="num"><strong>{{ r.calls | num }}</strong></td></tr>
              </tfoot>
            </table>
          </div>
        </div>
      }
    }
  `,
  styles: `
    .chart { display: flex; flex-direction: column; gap: 10px; padding: 4px 0 8px; }
    .bar-row { display: grid; grid-template-columns: minmax(90px, 22%) 1fr minmax(120px, auto); align-items: center; gap: 12px; }
    .bar-label { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar { width: 100%; height: 14px; display: block; }
    .bar-track { fill: var(--surface-2); }
    .bar-fill { fill: var(--primary); }
    .bar-val { font-size: 13px; text-align: right; white-space: nowrap; }
    @media (max-width: 560px) {
      .bar-row { grid-template-columns: 1fr; gap: 2px; }
      .bar-val { text-align: left; }
    }
  `,
})
export class ConsolaAnalisisComponent implements OnInit {
  private readonly api = inject(DimensionesApi);

  readonly dimensiones = input.required<Dimension[]>();

  readonly groupBy = signal<string>('');
  readonly range = signal<DateRange>(lastDays(30));
  readonly result = signal<AnalisisResult | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly tipoValorLabel = tipoValorLabel;
  readonly fmtUsd = formatUsd;

  readonly orderedGroups = computed(() => this.result()?.groups ?? []);

  ngOnInit() {
    const first = this.dimensiones()[0]?.codigo ?? '';
    this.groupBy.set(first);
    if (first) void this.load();
  }

  setGroupBy(codigo: string) {
    this.groupBy.set(codigo);
    void this.load();
  }

  onRange() {
    void this.load();
  }

  async load() {
    const groupBy = this.groupBy();
    if (!groupBy) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const { from, to } = rangeToIso(this.range());
      this.result.set(await this.api.analisis({ groupBy, from, to }));
    } catch (e) {
      this.error.set(errorMessage(e));
      this.result.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  pct(costUsd: number) {
    return barraPorcentaje(costUsd, this.orderedGroups());
  }

  pctTotal(costUsd: number, total: number) {
    return porcentajeDelTotal(costUsd, total);
  }

  fecha(iso: string) {
    return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  chartAria(r: AnalisisResult) {
    const top = r.groups.slice(0, 3).map((g) => `${g.label}: ${formatUsd(g.costUsd)}`).join('; ');
    return `Consumo por ${r.dimension.nombre}. Total ${formatUsd(r.totalCostUsd)}. ${top}`;
  }
}
