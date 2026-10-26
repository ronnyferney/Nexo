import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ConsolasApi } from '../../core/consolas.api';
import type { ConsolaGerencial, ConsolaGerencialFiltro } from '../../core/consolas.models';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { Agent, OrgUnit, OrgUnitOption } from '../../core/models';
import { PageHeaderComponent } from '../../layout/page-header.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { DateRangeComponent, lastDays, rangeToIso, type DateRange } from '../../shared/date-range.component';
import { UsdPipe } from '../../shared/usd.pipe';
import { empresasDe } from '../admin/estructura/estructura.util';
import { ResultadosKpisComponent } from '../resultados/resultados-kpis.component';
import { formatEntero, notaSinConsolidado, resumenAuditoria, selloIntegridad } from './consola-gerencial.util';

/** Tipos de unidad que ofrecemos como «área» en el filtro (todo lo que no es grupo ni empresa). */
const AREA_TIPOS = new Set(['UNIDAD_NEGOCIO', 'AREA_FUNCIONAL', 'DEPARTAMENTO', 'EQUIPO']);

interface Opcion {
  id: string;
  name: string;
}

/** Un indicador de estado operativo de gobierno con enlace a su bandeja. */
interface GobiernoCard {
  label: string;
  icon: string;
  value: number;
  link: string;
}

/**
 * Consola gerencial (E12 · vista ejecutiva para dirección). Consume `GET /consolas/gerencial` (rol mínimo ADMIN) y
 * reúne en una sola pantalla el estado del workspace para un alcance y período: resultados (E10, reusando las mismas
 * tarjetas del tablero de indicadores), economía (E9), estado operativo de gobierno (E6/E7) e integridad de la cadena
 * de auditoría (E13). La honestidad del dato manda: un `consolidado` en `null` muestra su causa, nunca un 0; y el sello
 * de integridad refleja literalmente el flag del backend.
 */
@Component({
  selector: 'nx-consola-gerencial',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    IconComponent,
    UsdPipe,
    PageHeaderComponent,
    DateRangeComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    LoadingStateComponent,
    ResultadosKpisComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nx-page-header
        heading="Consola gerencial"
        description="Resumen ejecutivo del workspace: resultados, economía, estado de gobierno e integridad de la auditoría, con sus fuentes a la vista"
        [crumbs]="[{ label: 'Dirección' }, { label: 'Consola gerencial' }]" />

      @if (!isAdmin()) {
        <nx-empty-state
          icon="shield"
          title="Acceso restringido"
          description="La consola gerencial es una vista de dirección disponible solo para administradores del workspace." />
      } @else {
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
          <nx-loading-state text="Cargando consola gerencial…" />
        } @else if (error()) {
          <nx-error-state title="No se pudo cargar la consola gerencial" message="{{ error() }}" (retry)="cargar()" />
        } @else if (data(); as d) {
          <p class="muted small periodo">Período: {{ dia(d.periodo.from) }} – {{ dia(d.periodo.to) }}</p>

          <section aria-labelledby="h-resultados">
            <div class="sec-head"><h2 id="h-resultados">Resultados</h2></div>
            <nx-resultados-kpis [kpis]="d.resultados" />
          </section>

          <section aria-labelledby="h-economia">
            <div class="sec-head"><h2 id="h-economia">Economía</h2></div>
            <div class="eco-grid">
              <div class="card eco-card">
                <div class="muted small">Costo atribuible del período</div>
                <div class="kpi-value">{{ d.economia.costoAtribuibleUsd | usd }}</div>
                <p class="muted small">Suma exacta del consumo imputado al alcance seleccionado.</p>
              </div>
              @if (d.economia.consolidado; as c) {
                <div class="card eco-card">
                  <div class="eco-top">
                    <div class="muted small">Libro consolidado (por {{ c.dimension }})</div>
                    <span class="badge info">Medido + estimado</span>
                  </div>
                  <div class="kpi-value">{{ c.totalMedidoUsd + c.totalEstimadoUsd | usd }}</div>
                  <div class="muted small">
                    Medido {{ c.totalMedidoUsd | usd }} · Estimado (reparto) {{ c.totalEstimadoUsd | usd }}
                  </div>
                  @if (c.grupos.length) {
                    <ul class="eco-grupos">
                      @for (g of c.grupos; track g.key) {
                        <li>
                          <span class="g-label">{{ g.label }}</span>
                          <span class="g-val">{{ g.costoMedidoUsd + g.costoEstimadoUsd | usd }}</span>
                        </li>
                      }
                    </ul>
                  }
                </div>
              } @else {
                <div class="card eco-card">
                  <div class="eco-top">
                    <div class="muted small">Libro consolidado</div>
                    <span class="badge warning">No disponible</span>
                  </div>
                  <div class="kpi-value na">Sin consolidado para este alcance</div>
                  <p class="muted small">{{ notaConsolidado(d) }}</p>
                </div>
              }
            </div>
          </section>

          <section aria-labelledby="h-gobierno">
            <div class="sec-head">
              <h2 id="h-gobierno">Estado de gobierno</h2>
              <span class="muted small">Estado operativo actual del workspace (no acotado al período).</span>
            </div>
            <div class="kpis">
              @for (g of gobiernoCards(); track g.label) {
                <a class="card gov-card" [routerLink]="g.link">
                  <div class="icon-tile"><nx-icon [name]="g.icon" /></div>
                  <div class="kpi-body">
                    <div class="muted small">{{ g.label }}</div>
                    <div class="kpi-value" [class.alerta]="g.value > 0">{{ format(g.value) }}</div>
                  </div>
                  <nx-icon name="arrowRight" [size]="16" class="go" aria-hidden="true" />
                </a>
              }
            </div>
          </section>

          <section aria-labelledby="h-auditoria">
            <div class="sec-head"><h2 id="h-auditoria">Integridad y auditoría</h2></div>
            <div class="card audit-card" [class.integra]="d.auditoria.cadenaIntegra" [class.rota]="!d.auditoria.cadenaIntegra">
              <div class="audit-sello">
                <span [class]="sello(d).badgeClass" [attr.aria-label]="resumen(d)">
                  <nx-icon [name]="sello(d).icon" [size]="15" />{{ sello(d).label }}
                </span>
                <span class="muted small">Sello de confianza de la cadena de auditoría (E13).</span>
              </div>
              <div class="audit-stats">
                <div class="stat">
                  <div class="muted small">Hechos en el período</div>
                  <div class="kpi-value">{{ format(d.auditoria.hechosEnPeriodo) }}</div>
                </div>
                <div class="stat">
                  <div class="muted small">Total de hechos</div>
                  <div class="kpi-value">{{ format(d.auditoria.totalHechos) }}</div>
                </div>
              </div>
              @if (!d.auditoria.cadenaIntegra && d.auditoria.motivo) {
                <p class="error-text small">
                  {{ d.auditoria.motivo }}@if (d.auditoria.rotaEnSeq != null) { (secuencia {{ d.auditoria.rotaEnSeq }}) }
                </p>
              }
            </div>
          </section>
        } @else {
          <nx-empty-state icon="chart" title="Sin datos" description="No hay datos para el período y los filtros elegidos." />
        }
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
    section { margin-top: 24px; }
    .sec-head { display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px; }
    .sec-head h2 { margin: 0; font-size: 16px; }
    .kpi-body { min-width: 0; }
    .kpi-value { font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.25; }
    .kpi-value.na { font-size: 14px; font-weight: 600; color: var(--muted); }
    .kpi-value.alerta { color: var(--warning); }
    .eco-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
    .eco-card { display: flex; flex-direction: column; gap: 6px; }
    .eco-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .eco-grupos { list-style: none; margin: 8px 0 0; padding: 8px 0 0; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 4px; }
    .eco-grupos li { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; }
    .eco-grupos .g-val { font-variant-numeric: tabular-nums; font-weight: 600; }
    .gov-card { display: flex; align-items: center; gap: 12px; text-decoration: none; color: inherit; transition: border-color .15s, background .15s; }
    .gov-card:hover { border-color: var(--primary); }
    .gov-card .go { margin-left: auto; color: var(--muted); flex-shrink: 0; }
    .gov-card:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .audit-card { display: flex; flex-direction: column; gap: 14px; border-left: 4px solid var(--border); }
    .audit-card.integra { border-left-color: var(--success); }
    .audit-card.rota { border-left-color: var(--danger); }
    .audit-sello { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .audit-stats { display: flex; flex-wrap: wrap; gap: 28px; }
    .error-text.small { font-size: 13px; margin: 0; }
    @media (max-width: 560px) { .field.apply { margin-left: 0; width: 100%; } .field.apply .btn { width: 100%; justify-content: center; } }
  `,
})
export class ConsolaGerencialPage implements OnInit {
  private readonly consolas = inject(ConsolasApi);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  readonly isAdmin = this.auth.isAdmin;

  readonly range = signal<DateRange>(lastDays(30));
  readonly empresaId = signal('');
  readonly areaId = signal('');
  readonly agentId = signal('');

  readonly data = signal<ConsolaGerencial | null>(null);
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

  readonly gobiernoCards = computed<GobiernoCard[]>(() => {
    const d = this.data();
    if (!d) return [];
    const g = d.gobierno;
    return [
      { label: 'Aprobaciones pendientes', icon: 'thumbsUp', value: g.aprobacionesPendientes, link: '/aprobaciones' },
      { label: 'Suspensiones activas', icon: 'stop', value: g.suspensionesActivas, link: '/admin/suspension' },
      { label: 'Excepciones abiertas', icon: 'alert', value: g.excepcionesAbiertas, link: '/excepciones' },
    ];
  });

  ngOnInit() {
    if (!this.isAdmin()) {
      this.loading.set(false);
      return;
    }
    void this.loadOpciones();
    void this.cargar();
  }

  sello(d: ConsolaGerencial) {
    return selloIntegridad(d.auditoria.cadenaIntegra);
  }

  resumen(d: ConsolaGerencial) {
    return resumenAuditoria(d.auditoria);
  }

  notaConsolidado(d: ConsolaGerencial) {
    return notaSinConsolidado(d.economia);
  }

  format(n: number) {
    return formatEntero(n);
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
      const filtro: ConsolaGerencialFiltro = {
        from: iso.from,
        to: iso.to,
        empresaId: this.empresaId() || undefined,
        areaId: this.areaId() || undefined,
        agentId: this.agentId() || undefined,
      };
      this.data.set(await this.consolas.consolaGerencial(filtro));
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
