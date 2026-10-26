import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { IndicadoresKpis } from '../../core/indicadores.models';
import { IconComponent } from '../../shared/icon.component';
import { formatUsd } from '../../shared/usd.pipe';
import { fraccion, formatPct, tiempoCicloLabel } from './resultados.util';

interface KpiCard {
  label: string;
  icon: string;
  value: string;
  /** `true` cuando no hay dato en el período: se muestra atenuado, nunca como un cero inventado. */
  na: boolean;
  sub: string;
}

/**
 * Tarjetas de los cinco KPIs comparables de resultado (cumplimiento, calidad, tiempo de ciclo, costo por resultado y
 * excepciones). Presentación pura y reutilizable: la usan el tablero de indicadores (E10) y la consola gerencial (E12)
 * para mostrar EXACTAMENTE las mismas cifras con las mismas reglas de honestidad (un `null` del backend es «Sin datos
 * en el período», jamás «0 %»).
 */
@Component({
  selector: 'nx-resultados-kpis',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="kpis">
      @for (k of cards(); track k.label) {
        <div class="card kpi-card">
          <div class="icon-tile"><nx-icon [name]="k.icon" /></div>
          <div class="kpi-body">
            <div class="muted small">{{ k.label }}</div>
            <div class="kpi-value" [class.na]="k.na">{{ k.value }}</div>
            @if (k.sub) { <div class="muted small">{{ k.sub }}</div> }
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .kpi-body { min-width: 0; }
    .kpi-value { font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.25; }
    .kpi-value.na { font-size: 14px; font-weight: 600; color: var(--muted); }
  `,
})
export class ResultadosKpisComponent {
  readonly kpis = input.required<IndicadoresKpis>();

  protected readonly cards = computed<KpiCard[]>(() => {
    const k = this.kpis();
    const costo = k.costoPorResultado.costoPorResultadoUsd;
    return [
      {
        label: 'Cumplimiento',
        icon: 'checkCircle',
        value: formatPct(k.cumplimiento.pct),
        na: k.cumplimiento.pct === null,
        sub: `${fraccion(k.cumplimiento)} compromisos · ${k.cumplimiento.vencimientosEnPeriodo} con vencimiento`,
      },
      {
        label: 'Calidad',
        icon: 'shield',
        value: formatPct(k.calidad.pct),
        na: k.calidad.pct === null,
        sub: `${fraccion(k.calidad)} aceptados · ${k.calidad.revisadosEnPeriodo} revisados`,
      },
      {
        label: 'Tiempo de ciclo (mediana / p95)',
        icon: 'clock',
        value: tiempoCicloLabel(k.tiempoCiclo),
        na: !k.tiempoCiclo,
        sub: k.tiempoCiclo ? `${k.tiempoCiclo.muestras} muestras aceptadas` : '',
      },
      {
        label: 'Costo por resultado',
        icon: 'wallet',
        value: costo === null ? '—' : formatUsd(costo),
        na: costo === null,
        sub: `Costo total ${formatUsd(k.costoPorResultado.costoTotalUsd)} · ${k.costoPorResultado.resultadosAceptados} aceptados`,
      },
      {
        label: 'Excepciones',
        icon: 'alert',
        value: formatPct(k.excepciones.pct),
        na: k.excepciones.pct === null,
        sub: `${fraccion(k.excepciones)} con excepción · ${k.excepciones.ejecucionesIniciadas} ejecuciones`,
      },
    ];
  });
}
