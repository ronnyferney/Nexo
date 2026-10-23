import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import type { HealthLevel } from '../../core/access.models';
import { errorMessage } from '../../core/api.service';
import { PlatformApi } from '../../core/platform.api';
import type { CopilotMetrics } from '../../core/platform.models';
import { HEALTH_LEVEL_META } from '../../core/access.models';
import { type DateRange, DateRangeComponent, rangeToIso } from '../../shared/date-range.component';
import { IconComponent } from '../../shared/icon.component';
import { formatScore } from '../../shared/score.pipe';
import { formatUsd, NumberPipe } from '../../shared/usd.pipe';
import { PlatformNavComponent } from './platform-nav.component';
import { SatisfactionDonutComponent } from './satisfaction-donut.component';

const LEVELS: HealthLevel[] = ['CRITICAL', 'NEEDS_WORK', 'GOOD', 'EXCELLENT'];
const LEVEL_COLOR: Record<HealthLevel, string> = {
  CRITICAL: 'var(--danger)',
  NEEDS_WORK: 'var(--warning)',
  GOOD: 'var(--info)',
  EXCELLENT: 'var(--success)',
};
const PCT = new Intl.NumberFormat('es', { style: 'percent', maximumFractionDigits: 0 });

/** Minutos legibles: `45 min`, `3 h 20 min`, `2 d 4 h`. */
export function formatMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined || Number.isNaN(min)) return '—';
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
  const h = Math.round((m % 1440) / 60);
  return `${Math.floor(m / 1440)} d${h ? ` ${h} h` : ''}`;
}

/** Puntaje que la API puede enviar en 0–1 o en 0–100. */
function normalizeScore(v: number | null | undefined): number | null {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  return v > 1 ? v / 100 : v;
}

/** Consola de plataforma: métricas de éxito de clientes (ADR 0006 D6). */
@Component({
  selector: 'nx-platform-success',
  imports: [IconComponent, DateRangeComponent, NumberPipe, PlatformNavComponent, SatisfactionDonutComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div><h1>Plataforma Nexo</h1><p>Éxito de los clientes y adopción de agentes en todos los workspaces</p></div>
        <nx-date-range [(range)]="range" />
      </div>
      <nx-platform-nav />

      @if (error()) {
        <div class="card empty"><nx-icon name="alert" [size]="28" /><h3>No se pudieron cargar las métricas</h3><p>{{ error() }}</p>
          <button class="btn" (click)="reload()">Reintentar</button></div>
      } @else {
        <div class="kpis" [attr.aria-busy]="loading()">
          @for (k of kpis(); track k.label) {
            <div class="card kpi-card">
              <div class="icon-tile"><nx-icon [name]="k.icon" /></div>
              <div><div class="muted small">{{ k.label }}</div><div class="kpi-value">{{ loading() ? '…' : k.value }}</div>
                @if (k.hint && !loading()) { <div class="muted small">{{ k.hint }}</div> }</div>
            </div>
          }
        </div>

        @if (metrics(); as m) {
          <div class="grid grid-2" style="margin-top:16px">
            <div class="card stack">
              <div class="card-title"><h2>Distribución de salud de agentes</h2><span class="spacer"></span>
                <span class="muted small">{{ healthTotal() | num }} agentes</span></div>
              @if (healthTotal()) {
                <div class="stacked-bar" role="img" [attr.aria-label]="healthAria()">
                  @for (h of health(); track h.level) {
                    @if (h.count) { <span [style.width.%]="h.pct * 100" [style.background]="h.color" [title]="h.label + ': ' + h.count"></span> }
                  }
                </div>
                <table class="table">
                  <tbody>
                    @for (h of health(); track h.level) {
                      <tr><td><span class="legend-dot" [style.background]="h.color"></span>{{ h.label }}</td>
                        <td class="num">{{ h.count | num }}</td><td class="num muted">{{ pct(h.pct) }}</td></tr>
                    }
                  </tbody>
                </table>
              } @else {
                <p class="muted small">Sin puntajes de salud en el período.</p>
              }
            </div>

            <div class="card stack">
              <div class="card-title"><h2>Adopción</h2></div>
              <div class="funnel">
                @for (f of funnel(); track f.label) {
                  <div class="funnel-row">
                    <span class="small">{{ f.label }}</span>
                    <div class="hbar" role="img" [attr.aria-label]="f.label + ': ' + f.value"><span [style.width.%]="f.pct * 100"></span></div>
                    <strong class="num">{{ f.value | num }}</strong>
                  </div>
                }
              </div>
              <div class="divider"></div>
              <div class="row" style="align-items:center; gap:18px">
                <nx-satisfaction-donut [up]="m.copilotSatisfaction.up" [down]="m.copilotSatisfaction.down" />
                <div class="stack" style="gap:4px">
                  <strong>Satisfacción con el Copilot</strong>
                  <span class="small">👍 {{ m.copilotSatisfaction.up | num }} · 👎 {{ m.copilotSatisfaction.down | num }}</span>
                  <span class="muted small">Calificaciones de respuestas del Copilot en el período.</span>
                </div>
              </div>
            </div>
          </div>

          <div class="card" style="margin-top:16px">
            <div class="card-title"><h2>Workspaces en riesgo</h2>
              <span class="badge" [class.danger]="m.atRiskWorkspaces.length > 0">{{ m.atRiskWorkspaces.length }}</span></div>
            @if (m.atRiskWorkspaces.length) {
              <div class="table-wrap">
                <table class="table">
                  <thead><tr><th>Workspace</th><th>Motivo</th></tr></thead>
                  <tbody>
                    @for (w of m.atRiskWorkspaces; track w.id) {
                      <tr><td><strong>{{ w.name }}</strong><div class="mono small muted">{{ w.id }}</div></td>
                        <td><span class="badge warning"><nx-icon name="alert" [size]="12" />{{ w.reason }}</span></td></tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="muted small">Ningún workspace en riesgo en el período.</p>
            }
          </div>
        }
      }
    </div>
  `,
  styles: `
    .stacked-bar { display: flex; height: 18px; border-radius: 999px; overflow: hidden; background: var(--surface-2); border: 1px solid var(--border); }
    .stacked-bar > span { display: block; height: 100%; min-width: 3px; }
    .legend-dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 8px; vertical-align: -1px; }
    .funnel { display: flex; flex-direction: column; gap: 10px; }
    .funnel-row { display: grid; grid-template-columns: 150px 1fr 60px; gap: 12px; align-items: center; }
  `,
})
export class PlatformSuccessPage {
  private readonly api = inject(PlatformApi);
  readonly range = this.api.range;
  readonly metrics = signal<CopilotMetrics | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  private requestId = 0;

  readonly health = computed(() => {
    const dist = this.metrics()?.healthDistribution ?? {};
    const total = LEVELS.reduce((s, l) => s + (dist[l] ?? 0), 0);
    return LEVELS.map((level) => {
      const count = dist[level] ?? 0;
      return { level, count, pct: total ? count / total : 0, color: LEVEL_COLOR[level], label: HEALTH_LEVEL_META[level].label };
    });
  });
  readonly healthTotal = computed(() => this.health().reduce((s, h) => s + h.count, 0));
  readonly healthAria = computed(() => this.health().map((h) => `${h.label}: ${h.count}`).join(', '));

  readonly funnel = computed(() => {
    const m = this.metrics();
    if (!m) return [];
    const max = Math.max(m.workspaces, m.agentsCreated, 1);
    return [
      { label: 'Workspaces', value: m.workspaces },
      { label: 'Workspaces activos', value: m.activeWorkspaces },
      { label: 'Agentes creados', value: m.agentsCreated },
      { label: 'Agentes lanzados', value: m.agentsLaunched },
    ].map((f) => ({ ...f, pct: f.value / max }));
  });

  readonly kpis = computed(() => {
    const m = this.metrics();
    const ratio = (a: number, b: number) => (b ? PCT.format(a / b) : '—');
    const votes = m ? m.copilotSatisfaction.up + m.copilotSatisfaction.down : 0;
    return [
      { label: 'Workspaces', icon: 'building', value: m ? String(m.workspaces) : '—', hint: m ? `${m.activeWorkspaces} activos (${ratio(m.activeWorkspaces, m.workspaces)})` : '' },
      { label: 'Agentes creados', icon: 'bot', value: m ? String(m.agentsCreated) : '—', hint: '' },
      { label: 'Agentes lanzados', icon: 'rocket', value: m ? String(m.agentsLaunched) : '—', hint: m ? `${ratio(m.agentsLaunched, m.agentsCreated)} de los creados` : '' },
      { label: 'Mediana hasta el primer lanzamiento', icon: 'clock', value: formatMinutes(m?.medianMinutesToFirstLaunch), hint: '' },
      { label: 'Evaluación promedio', icon: 'target', value: formatScore(normalizeScore(m?.avgEvalScore)), hint: '' },
      { label: 'Satisfacción del Copilot', icon: 'thumbsUp', value: m ? ratio(m.copilotSatisfaction.up, votes) : '—', hint: m ? `${votes} calificaciones` : '' },
      { label: 'Consumo del cupo del Copilot', icon: 'wallet', value: formatUsd(m?.quotaUsageUsd), hint: m && m.activeWorkspaces ? `${formatUsd(m.quotaUsageUsd / m.activeWorkspaces)} por workspace activo` : '' },
    ];
  });

  constructor() {
    effect(() => {
      const r = this.range();
      untracked(() => void this.load(r));
    });
  }

  reload() {
    void this.load(this.range());
  }

  pct(v: number) {
    return PCT.format(v);
  }

  private async load(r: DateRange) {
    const id = ++this.requestId;
    this.loading.set(true);
    this.error.set(null);
    try {
      const { from, to } = rangeToIso(r);
      const m = await this.api.metrics(from, to);
      if (id === this.requestId) this.metrics.set(m);
    } catch (e) {
      if (id === this.requestId) this.error.set(errorMessage(e));
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }
}
