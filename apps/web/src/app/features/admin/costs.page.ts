import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../core/api.service';
import type { UsageGroupBy, UsageRecord, UsageSummary } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { formatUsd, NumberPipe, UsdPipe } from '../../shared/usd.pipe';

type Range = 'month' | '7d' | '30d';
const PAGE_SIZE = 25;

@Component({
  selector: 'nx-admin-costs',
  imports: [
    FormsModule,
    IconComponent,
    RelativeTimePipe,
    UsdPipe,
    NumberPipe,
    EmptyStateComponent,
    ErrorStateComponent,
    LoadingStateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div><h1>Costos de IA</h1><p>Consumo de modelos por unidad, modelo, agente, usuario o día</p></div>
        <div class="row wrap">
          <div class="field">
            <label for="cost-range">Rango</label>
            <select id="cost-range" class="input" [ngModel]="range()" (ngModelChange)="setRange($event)">
              @for (r of ranges; track r.id) { <option [value]="r.id">{{ r.label }}</option> }
            </select>
          </div>
          <div class="field">
            <label for="cost-group">Agrupar por</label>
            <select id="cost-group" class="input" [ngModel]="groupBy()" (ngModelChange)="setGroupBy($event)">
              @for (g of groupings; track g.id) { <option [value]="g.id">{{ g.label }}</option> }
            </select>
          </div>
        </div>
      </div>

      <div class="callout info" style="margin-bottom:16px">
        <nx-icon name="info" [size]="16" />
        <span>Costos estimados según precios configurados; la factura del proveedor prevalece.</span>
      </div>

      @if (error()) {
        <nx-error-state title="No se pudo cargar el resumen" message="{{ error() }}" (retry)="loadSummary()" />
      } @else {
        <div class="kpis">
          @for (k of kpis(); track k.label) {
            <div class="card kpi-card">
              <div class="icon-tile"><nx-icon [name]="k.icon" /></div>
              <div><div class="muted small">{{ k.label }}</div><div class="kpi-value">{{ loading() ? '…' : k.value }}</div></div>
            </div>
          }
        </div>

        <div class="card" style="margin-top:16px">
          <div class="card-title"><h2>Costo por {{ groupLabel() }}</h2><span class="spacer"></span>
            @if (summary(); as s) { <span class="muted small">{{ day(s.from) }} – {{ day(s.to) }}</span> }</div>
          @if (loading()) {
            <nx-loading-state text="Cargando…" />
          } @else if (!groups().length) {
            <nx-empty-state icon="chart" title="Sin consumo en el rango" description="Aún no hay llamadas a modelos registradas." />
          } @else {
            @if (groupBy() === 'day') {
              <div class="vbars" role="img" [attr.aria-label]="'Costo diario, máximo ' + (maxCost() | usd)">
                @for (g of groups(); track g.key) {
                  <div class="vbar" [title]="g.label + ': ' + (g.costUsd | usd) + ' · ' + (g.calls | num) + ' llamadas'">
                    <div class="vbar-track"><span [style.height.%]="share(g.costUsd)"></span></div><small>{{ shortDay(g.key, g.label) }}</small>
                  </div>
                }
              </div>
              <div class="divider"></div>
            }
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>{{ groupTitle() }}</th><th style="width:34%">Proporción</th><th class="num">Costo</th><th class="num">Llamadas</th>
                  <th class="num">Tokens entrada</th><th class="num">Tokens salida</th></tr></thead>
                <tbody>
                  @for (g of groups(); track g.key) {
                    <tr>
                      <td><strong>{{ g.label || g.key }}</strong></td>
                      <td><div class="hbar" [title]="pctOfTotal(g.costUsd) + ' % del total'"><span [style.width.%]="share(g.costUsd)"></span></div></td>
                      <td class="num">{{ g.costUsd | usd }}</td>
                      <td class="num">{{ g.calls | num }}</td>
                      <td class="num">{{ g.inputTokens | num }}</td>
                      <td class="num">{{ g.outputTokens | num }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      }

      <div class="card" style="margin-top:16px; padding:0">
        <div class="card-title" style="padding:16px 20px 0"><h2>Registros recientes</h2><span class="spacer"></span>
          <button class="btn sm" (click)="loadRecords(true)" [disabled]="recordsLoading()"><nx-icon name="refresh" [size]="14" />Actualizar</button></div>
        @if (recordsError()) {
          <nx-error-state title="No se pudieron cargar los registros" message="{{ recordsError() }}" (retry)="loadRecords(true)" />
        } @else if (records().length) {
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Fecha</th><th>Origen</th><th>Modelo</th><th>Unidad</th><th>Usuario</th><th>Agente</th>
                <th class="num">Entrada</th><th class="num">Salida</th><th class="num">Costo</th></tr></thead>
              <tbody>
                @for (r of records(); track r.id) {
                  <tr>
                    <td class="muted small nowrap" [title]="r.createdAt">{{ r.createdAt | ago }}</td>
                    <td><span class="badge">{{ r.source }}</span></td>
                    <td><code>{{ r.model }}</code><div class="muted small">{{ r.providerId }}</div></td>
                    <td>{{ r.orgUnitName }}</td>
                    <td>{{ r.userName || '—' }}</td>
                    <td>{{ r.agentName || '—' }}</td>
                    <td class="num">{{ r.inputTokens | num }}</td>
                    <td class="num">{{ r.outputTokens | num }}</td>
                    <td class="num">{{ r.costUsd | usd: 'precise' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (nextCursor()) {
            <div class="row" style="justify-content:center; padding:14px">
              <button class="btn" (click)="loadRecords()" [disabled]="recordsLoading()">{{ recordsLoading() ? 'Cargando…' : 'Cargar más' }}</button>
            </div>
          }
        } @else if (recordsLoading()) {
          <nx-loading-state text="Cargando registros…" />
        } @else {
          <nx-empty-state icon="chart" title="Sin registros" description="No hay registros de consumo todavía." />
        }
      </div>
    </div>
  `,
})
export class CostsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly ranges: { id: Range; label: string }[] = [
    { id: 'month', label: 'Este mes' },
    { id: '7d', label: 'Últimos 7 días' },
    { id: '30d', label: 'Últimos 30 días' },
  ];
  readonly groupings: { id: UsageGroupBy; label: string }[] = [
    { id: 'orgUnit', label: 'Unidad' },
    { id: 'model', label: 'Modelo' },
    { id: 'agent', label: 'Agente' },
    { id: 'user', label: 'Usuario' },
    { id: 'day', label: 'Día' },
  ];

  readonly range = signal<Range>('month');
  readonly groupBy = signal<UsageGroupBy>('orgUnit');
  readonly summary = signal<UsageSummary | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly records = signal<UsageRecord[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly recordsLoading = signal(false);
  readonly recordsError = signal<string | null>(null);

  readonly groups = computed(() => this.summary()?.groups ?? []);
  readonly maxCost = computed(() => Math.max(0, ...this.groups().map((g) => g.costUsd)));
  readonly groupTitle = computed(() => this.groupings.find((g) => g.id === this.groupBy())?.label ?? '');
  readonly groupLabel = computed(() => this.groupings.find((g) => g.id === this.groupBy())?.label.toLowerCase() ?? '');
  readonly kpis = computed(() => {
    const s = this.summary();
    const n = new Intl.NumberFormat('es');
    return [
      { label: 'Costo total', icon: 'wallet', value: s ? formatUsd(s.totalCostUsd) : '—' },
      { label: 'Llamadas', icon: 'zap', value: s ? n.format(s.calls) : '—' },
      { label: 'Tokens de entrada', icon: 'cpu', value: s ? n.format(s.inputTokens) : '—' },
      { label: 'Tokens de salida', icon: 'sparkles', value: s ? n.format(s.outputTokens) : '—' },
    ];
  });

  ngOnInit() {
    void this.loadSummary();
    void this.loadRecords(true);
  }

  setRange(r: Range) {
    this.range.set(r);
    void this.loadSummary();
  }

  setGroupBy(g: UsageGroupBy) {
    this.groupBy.set(g);
    void this.loadSummary();
  }

  async loadSummary() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.summary.set(await this.api.usageSummary({ ...this.bounds(), groupBy: this.groupBy() }));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async loadRecords(reset = false) {
    this.recordsLoading.set(true);
    this.recordsError.set(null);
    try {
      const page = await this.api.usageRecords({ take: PAGE_SIZE, cursor: reset ? undefined : (this.nextCursor() ?? undefined) });
      this.records.update((r) => (reset ? page.items : [...r, ...page.items]));
      this.nextCursor.set(page.nextCursor);
    } catch (e) {
      if (reset) this.recordsError.set(errorMessage(e));
      else this.toast.error(errorMessage(e));
    } finally {
      this.recordsLoading.set(false);
    }
  }

  /** Porcentaje (0–100) respecto al grupo de mayor costo, para dimensionar las barras. */
  share(cost: number) {
    const max = this.maxCost();
    return max > 0 ? (cost / max) * 100 : 0;
  }

  pctOfTotal(cost: number) {
    const total = this.summary()?.totalCostUsd ?? 0;
    return total > 0 ? Math.round((cost / total) * 1000) / 10 : 0;
  }

  day(iso: string) {
    return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });
  }

  shortDay(key: string, label: string) {
    const d = new Date(key.length === 10 ? `${key}T00:00:00Z` : key);
    return Number.isNaN(d.getTime()) ? label : d.toLocaleDateString('es', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  private bounds(): { from: string; to: string } {
    const now = new Date();
    const to = now.toISOString();
    if (this.range() === 'month') return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(), to };
    const days = this.range() === '7d' ? 7 : 30;
    return { from: new Date(now.getTime() - days * 86_400_000).toISOString(), to };
  }
}
