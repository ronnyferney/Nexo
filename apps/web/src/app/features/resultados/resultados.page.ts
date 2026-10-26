import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IndicadoresApi } from '../../core/indicadores.api';
import type { IndicadoresFiltro, IndicadoresResultados } from '../../core/indicadores.models';
import { ApiService, errorMessage } from '../../core/api.service';
import type { Agent, OrgUnit, OrgUnitOption } from '../../core/models';
import { PageHeaderComponent } from '../../layout/page-header.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { DateRangeComponent, lastDays, rangeToIso, type DateRange } from '../../shared/date-range.component';
import { UsdPipe, formatUsd } from '../../shared/usd.pipe';
import { empresasDe } from '../admin/estructura/estructura.util';
import { fraccion, formatPct, tiempoCicloLabel } from './resultados.util';

/** Tipos de unidad que ofrecemos como «área» en el filtro (todo lo que no es grupo ni empresa). */
const AREA_TIPOS = new Set(['UNIDAD_NEGOCIO', 'AREA_FUNCIONAL', 'DEPARTAMENTO', 'EQUIPO']);

interface Opcion {
  id: string;
  name: string;
}

interface KpiCard {
  label: string;
  icon: string;
  value: string;
  /** `true` cuando no hay dato en el período: se muestra atenuado, nunca como un cero inventado. */
  na: boolean;
  sub: string;
}

/**
 * Tablero de indicadores de resultado (E10). Consume `GET /indicadores/resultados` (rol mínimo VIEWER) y presenta
 * cinco KPIs comparables (cumplimiento, calidad, tiempo de ciclo, costo por resultado y excepciones) más una sección
 * aparte de estimaciones / pendientes de fuente (horas liberadas y beneficio validado), siempre rotuladas como tales.
 * La honestidad del dato manda: un `null` del backend se muestra como «Sin datos en el período», jamás como «0 %».
 */
@Component({
  selector: 'nx-resultados',
  imports: [
    FormsModule,
    IconComponent,
    UsdPipe,
    PageHeaderComponent,
    DateRangeComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    LoadingStateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nx-page-header
        heading="Indicadores de resultado"
        description="Cumplimiento, calidad, tiempo de ciclo, costo por resultado y excepciones del período, con sus fuentes a la vista"
        [crumbs]="[{ label: 'Gobierno' }, { label: 'Indicadores de resultado' }]" />

      <form class="card filtros" (ngSubmit)="aplicar()">
        <div class="field rango">
          <label id="lbl-rango">Rango de fechas</label>
          <nx-date-range [(range)]="range" aria-labelledby="lbl-rango" />
        </div>
        @if (empresas().length) {
          <div class="field">
            <label for="f-empresa">Empresa</label>
            <select id="f-empresa" class="input" [ngModel]="empresaId()" name="empresa" (ngModelChange)="setEmpresa($event)">
              <option value="">Todas</option>
              @for (e of empresas(); track e.id) { <option [value]="e.id">{{ e.name }}</option> }
            </select>
          </div>
        }
        @if (areas().length) {
          <div class="field">
            <label for="f-area">Área</label>
            <select id="f-area" class="input" [ngModel]="areaId()" name="area" (ngModelChange)="areaId.set($event)">
              <option value="">Todas</option>
              @for (a of areas(); track a.id) { <option [value]="a.id">{{ a.name }}</option> }
            </select>
          </div>
        }
        @if (agents().length) {
          <div class="field">
            <label for="f-agente">Agente</label>
            <select id="f-agente" class="input" [ngModel]="agentId()" name="agente" (ngModelChange)="agentId.set($event)">
              <option value="">Todos</option>
              @for (g of agents(); track g.id) { <option [value]="g.id">{{ g.name }}</option> }
            </select>
          </div>
        }
        <div class="field apply">
          <button type="submit" class="btn primary" [disabled]="loading()">
            <nx-icon name="refresh" [size]="15" />Aplicar
          </button>
        </div>
      </form>

      @if (loading()) {
        <nx-loading-state text="Cargando indicadores…" />
      } @else if (error()) {
        <nx-error-state title="No se pudieron cargar los indicadores" message="{{ error() }}" (retry)="cargar()" />
      } @else if (data(); as d) {
        <p class="muted small periodo">
          Período: {{ dia(d.periodo.from) }} – {{ dia(d.periodo.to) }}
        </p>

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

        <section class="estimaciones" aria-labelledby="h-est">
          <div class="sec-head">
            <h2 id="h-est">Estimaciones / pendientes de fuente</h2>
            <span class="muted small">Valores aún sin fuente confiable: se muestran como estimación o pendiente, nunca como resultado confirmado.</span>
          </div>
          <div class="kpis">
            <div class="card est-card">
              <div class="est-top">
                <div class="row"><nx-icon name="clock" [size]="16" /><strong>Horas liberadas</strong></div>
                <span class="badge warning">Estimación</span>
              </div>
              <div class="kpi-value na">Pendiente de fuente</div>
              <p class="muted small">{{ d.kpis.horasLiberadas.nota }}</p>
            </div>
            <div class="card est-card">
              <div class="est-top">
                <div class="row"><nx-icon name="wallet" [size]="16" /><strong>Beneficio validado</strong></div>
                <span class="badge" [class.success]="beneficioValidado(d)" [class.warning]="!beneficioValidado(d)">
                  {{ beneficioValidado(d) ? 'Validado' : 'Pendiente' }}
                </span>
              </div>
              <div class="kpi-value" [class.na]="!beneficioValidado(d)">
                {{ beneficioValidado(d) ? (d.kpis.beneficioValidado.validadoUsd | usd) : 'Pendiente de fuente' }}
              </div>
              @if (d.kpis.beneficioValidado.proyectadoUsd !== null) {
                <div class="muted small">Proyectado: {{ d.kpis.beneficioValidado.proyectadoUsd | usd }}</div>
              }
              <p class="muted small">{{ d.kpis.beneficioValidado.nota }}</p>
            </div>
          </div>
        </section>
      } @else {
        <nx-empty-state icon="chart" title="Sin indicadores" description="No hay datos para el período y los filtros elegidos." />
      }
    </div>
  `,
  styles: `
    .filtros { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 14px 18px; margin-bottom: 18px; }
    .field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .field.rango { flex: 1 1 auto; }
    .field.apply { margin-left: auto; }
    .field label { font-size: 12.5px; font-weight: 600; color: var(--muted); }
    .field select { min-width: 160px; }
    .periodo { margin: 0 2px 14px; }
    .kpi-body { min-width: 0; }
    .kpi-value { font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.25; }
    .kpi-value.na { font-size: 14px; font-weight: 600; color: var(--muted); }
    .estimaciones { margin-top: 24px; }
    .sec-head { display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px; }
    .sec-head h2 { margin: 0; font-size: 16px; }
    .est-card { display: flex; flex-direction: column; gap: 8px; }
    .est-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .est-top .row { display: inline-flex; align-items: center; gap: 8px; }
    .est-card p { margin: 0; }
    @media (max-width: 560px) { .field.apply { margin-left: 0; width: 100%; } .field.apply .btn { width: 100%; justify-content: center; } }
  `,
})
export class ResultadosPage implements OnInit {
  private readonly indicadores = inject(IndicadoresApi);
  private readonly api = inject(ApiService);

  readonly range = signal<DateRange>(lastDays(30));
  readonly empresaId = signal('');
  readonly areaId = signal('');
  readonly agentId = signal('');

  readonly data = signal<IndicadoresResultados | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  /** Unidades ricas (tipo + empresa) cuando el rol las permite; si no, lista plana de respaldo. */
  private readonly units = signal<OrgUnit[]>([]);
  private readonly flat = signal<OrgUnitOption[]>([]);
  readonly agents = signal<Agent[]>([]);

  readonly empresas = computed<Opcion[]>(() => empresasDe(this.units()).map((u) => ({ id: u.id, name: u.name })));
  readonly areas = computed<Opcion[]>(() => {
    const rich = this.units();
    if (rich.length) {
      const emp = this.empresaId();
      return rich
        .filter((u) => AREA_TIPOS.has(u.tipo))
        .filter((u) => !emp || u.empresaId === emp)
        .map((u) => ({ id: u.id, name: u.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    }
    return this.flat()
      .map((u) => ({ id: u.id, name: u.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  });

  readonly cards = computed<KpiCard[]>(() => {
    const d = this.data();
    if (!d) return [];
    const k = d.kpis;
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

  ngOnInit() {
    void this.loadOpciones();
    void this.cargar();
  }

  /** `true` cuando el beneficio validado tiene cifra confirmada (no una proyección). */
  beneficioValidado(d: IndicadoresResultados): boolean {
    return d.kpis.beneficioValidado.validadoUsd !== null;
  }

  setEmpresa(id: string) {
    this.empresaId.set(id);
    // Si el área elegida ya no pertenece a la empresa, se limpia para no filtrar por algo oculto.
    if (this.areaId() && !this.areas().some((a) => a.id === this.areaId())) this.areaId.set('');
  }

  aplicar() {
    void this.cargar();
  }

  async cargar() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const iso = rangeToIso(this.range());
      const filtro: IndicadoresFiltro = {
        from: iso.from,
        to: iso.to,
        empresaId: this.empresaId() || undefined,
        areaId: this.areaId() || undefined,
        agentId: this.agentId() || undefined,
      };
      this.data.set(await this.indicadores.indicadoresResultados(filtro));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  /** Carga las opciones de los filtros. Tolera la falta de permisos: la página sigue siendo útil sin ellas. */
  private async loadOpciones() {
    try {
      this.units.set(await this.api.adminOrgUnits());
    } catch {
      try {
        this.flat.set(await this.api.orgUnits());
      } catch {
        /* sin opciones de unidad: los filtros de empresa/área quedan ocultos */
      }
    }
    try {
      this.agents.set(await this.api.agents());
    } catch {
      /* sin opciones de agente: el filtro de agente queda oculto */
    }
  }

  dia(iso: string) {
    return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
