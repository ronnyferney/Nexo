import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.service';
import { EstructuraApi } from '../../core/estructura.api';
import { ImputacionApi } from '../../core/imputacion.api';
import type {
  ConsolidacionResult,
  DimensionConsolidacion,
  ServicioCompartidoReparto,
  TipoDestino,
} from '../../core/imputacion.models';
import { DIMENSIONES_CONSOLIDACION } from '../../core/imputacion.models';
import type { OrgUnit } from '../../core/models';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { DateRangeComponent, lastDays, rangeToIso, type DateRange } from '../../shared/date-range.component';
import { formatUsd, NumberPipe, UsdPipe } from '../../shared/usd.pipe';
import {
  barraPorcentaje,
  DIMENSION_LABEL,
  montoConsolidado,
  periodoLabel,
  porcentajeDelTotal,
  tipoDestinoLabel,
} from './imputacion.util';

/**
 * Consola de consolidación económica (ADR 0011 D7 · E9 · RF47 parcial). Pivota el costo por empresa / línea / área /
 * centro de costo en un rango de fechas, separando el costo MEDIDO (snapshot del consumo) del ESTIMADO (reparto de los
 * servicios compartidos). Gráfico de barras agrupadas (SVG inline) + tabla y un detalle de los servicios compartidos
 * con su costo medido y su reparto. Solo lectura; no inventa datos (empty-state si no hay consumo en el rango).
 */
@Component({
  selector: 'nx-consola-consolidacion',
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
  templateUrl: './consola-consolidacion.component.html',
  styles: `
    .legend { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
    .swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
    .swatch.medido { background: var(--primary); }
    .swatch.estimado { background: var(--warning); }
    .chart { display: flex; flex-direction: column; gap: 12px; padding: 4px 0 8px; }
    .bar-row { display: grid; grid-template-columns: minmax(90px, 22%) 1fr minmax(160px, auto); align-items: center; gap: 12px; }
    .bar-label { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bars { display: flex; flex-direction: column; gap: 3px; }
    .bar { width: 100%; height: 9px; display: block; }
    .bar-track { fill: var(--surface-2); }
    .bar-medido { fill: var(--primary); }
    .bar-estimado { fill: var(--warning); }
    .bar-val { font-size: 13px; text-align: right; white-space: nowrap; }
    .svc { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; }
    .svc-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
    .table.compact th, .table.compact td { padding: 6px 10px; }
    @media (max-width: 560px) {
      .bar-row { grid-template-columns: 1fr; gap: 4px; }
      .bar-val { text-align: left; }
    }
  `,
})
export class ConsolaConsolidacionComponent implements OnInit {
  private readonly imputacion = inject(ImputacionApi);
  private readonly estructura = inject(EstructuraApi);

  readonly empresas = input.required<OrgUnit[]>();
  readonly units = input.required<OrgUnit[]>();

  readonly dimensiones = DIMENSIONES_CONSOLIDACION;
  readonly dimensionLabel = DIMENSION_LABEL;
  readonly tipoDestinoLabel = tipoDestinoLabel;
  readonly periodoLabel = periodoLabel;
  readonly fmtUsd = formatUsd;

  readonly dimension = signal<DimensionConsolidacion>('empresa');
  readonly empresaId = signal<string>('');
  readonly range = signal<DateRange>(lastDays(30));
  readonly result = signal<ConsolidacionResult | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Mapa id→etiqueta de todos los destinos posibles (líneas, áreas, centros), para el detalle de servicios. */
  private readonly etiquetas = signal<Map<string, string>>(new Map());

  readonly groups = computed(() => this.result()?.groups ?? []);
  readonly maxMonto = computed(() => Math.max(0, ...this.groups().map((g) => montoConsolidado(g))));
  readonly totalGeneral = computed(() => {
    const r = this.result();
    return r ? r.totalMedidoUsd + r.totalEstimadoUsd : 0;
  });
  readonly sinDatos = computed(() => {
    const r = this.result();
    return !!r && (!r.groups.length || this.totalGeneral() === 0);
  });

  ngOnInit() {
    void this.loadEtiquetas();
    void this.load();
  }

  private async loadEtiquetas() {
    const [lineas, centros] = await Promise.all([
      this.estructura.lineas().catch(() => []),
      this.estructura.centros().catch(() => []),
    ]);
    const mapa = new Map<string, string>();
    for (const l of lineas) mapa.set(l.id, `${l.codigo} · ${l.nombre}`);
    for (const c of centros) mapa.set(c.id, `${c.codigo} · ${c.nombre}`);
    for (const u of this.units()) mapa.set(u.id, u.name);
    this.etiquetas.set(mapa);
  }

  setDimension(d: DimensionConsolidacion) {
    this.dimension.set(d);
    void this.load();
  }

  onFiltro() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const { from, to } = rangeToIso(this.range());
      this.result.set(
        await this.imputacion.consolidacion({
          dimension: this.dimension(),
          from,
          to,
          empresaId: this.empresaId() || undefined,
        }),
      );
    } catch (e) {
      this.error.set(errorMessage(e));
      this.result.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  destinoLabel(tipo: TipoDestino, destinoId: string): string {
    return this.etiquetas().get(destinoId) ?? `${tipoDestinoLabel(tipo)} · ${destinoId}`;
  }

  barraMedido(valor: number) {
    return barraPorcentaje(valor, this.maxMonto());
  }

  pctTotal(valor: number) {
    return porcentajeDelTotal(valor, this.totalGeneral());
  }

  fecha(iso: string) {
    return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  chartAria(r: ConsolidacionResult) {
    const top = r.groups
      .slice(0, 3)
      .map((g) => `${g.label}: medido ${formatUsd(g.costoMedidoUsd)}, estimado ${formatUsd(g.costoEstimadoUsd)}`)
      .join('; ');
    return `Costo por ${DIMENSION_LABEL[r.dimension]}. Total medido ${formatUsd(r.totalMedidoUsd)}, total estimado ${formatUsd(r.totalEstimadoUsd)}. ${top}`;
  }

  trackServicio(s: ServicioCompartidoReparto) {
    return `${s.servicioId}:${s.periodoKey}`;
  }
}
