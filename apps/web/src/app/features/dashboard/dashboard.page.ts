import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent } from '../../layout/page-header.component';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { AccessApi } from '../../core/access.api';
import type { AgentHealthSummary } from '../../core/access.models';
import type { Execution, MyUsage, Stats } from '../../core/models';
import { INDUSTRY_TEMPLATES } from '../agents/industry-templates';
import { budgetLevel, periodLabel, POLICY_LABELS } from '../../shared/budget';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { ProgressBarComponent } from '../../shared/progress-bar.component';
import { StatusBadgeComponent } from '../../shared/status-badge.component';
import { NumberPipe, UsdPipe } from '../../shared/usd.pipe';

@Component({
  selector: 'nx-dashboard',
  imports: [RouterLink, PageHeaderComponent, IconComponent, StatusBadgeComponent, RelativeTimePipe, ProgressBarComponent, UsdPipe, NumberPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nx-page-header hostClass="brand-hero" [heading]="greeting()"
        description="Resumen de su plataforma de agentes y automatización" />


      @if (critical().length) {
        <div class="callout danger crit" role="alert">
          <nx-icon name="heartPulse" [size]="18" />
          <div class="grow">
            <strong>{{ critical().length === 1 ? 'Un agente necesita atención urgente' : critical().length + ' agentes necesitan atención urgente' }}</strong>
            <p>Su puntaje de salud es crítico: revise las recomendaciones o pida ayuda a Nexo Copilot.</p>
            <ul class="crit-list">
              @for (h of critical().slice(0, 5); track h.agentId) {
                <li><a [routerLink]="['/agents', h.agentId]">{{ h.name }}</a><span class="score">{{ h.score }} / 100</span></li>
              }
            </ul>
            @if (critical().length > 5) { <a routerLink="/agents" class="small">Ver los {{ critical().length }} agentes</a> }
          </div>
        </div>
      }

      <div class="grid grid-4">
        @for (k of kpis(); track k.label) {
          <a class="card hover kpi" [routerLink]="k.link">
            <div class="icon-tile"><nx-icon [name]="k.icon" /></div>
            <div><div class="muted small">{{ k.label }}</div><div class="value">{{ k.value }}</div></div>
          </a>
        }
      </div>

      @if (usage(); as u) {
        <a class="card hover budget-card" routerLink="/my-usage" style="margin-top:16px">
          <div class="icon-tile"><nx-icon name="wallet" /></div>
          @if (u.budgets[0]; as b) {
            <div class="budget-body">
              <div class="row wrap small">
                <strong class="title">Mi presupuesto</strong><span class="muted">{{ b.orgUnitName }} · {{ periodLabel(b.period) }} {{ b.periodKey }}</span>
                <span class="spacer"></span>
                <span class="badge">{{ policyLabels[b.policy] }}</span>
                <span class="pct {{ level(b.pct) }}">{{ b.pct | num: 1 }} %</span>
              </div>
              <nx-progress [pct]="b.pct" label="Consumo de mi presupuesto" />
              <div class="small muted">{{ b.spentUsd | usd }} de {{ b.limitUsd | usd }} · Mi consumo este mes: <strong class="me">{{ u.me.costUsd | usd }}</strong></div>
            </div>
          } @else {
            <div class="budget-body">
              <strong class="title small">Mi presupuesto</strong>
              <div class="small muted">Su unidad ({{ u.orgUnit.name }}) no tiene presupuesto definido · Mi consumo este mes: <strong class="me">{{ u.me.costUsd | usd }}</strong></div>
            </div>
          }
          <nx-icon name="arrowLeft" class="go" [size]="16" />
        </a>
      }

      <div class="grid grid-2" style="margin-top:16px">
        <div class="card">
          <div class="card-title"><h2>Primeros pasos</h2></div>
          <ol class="steps">
            <li><a routerLink="/connectors">Cree un conector</a> REST, SOAP, GraphQL o MCP e importe sus operaciones.</li>
            <li><a routerLink="/agents/new">Cree un agente con Nexo Copilot</a> partiendo de una plantilla:
              <span class="tpls">
                @for (t of templates; track t.id) {
                  <a class="badge primary" routerLink="/agents/new" [queryParams]="{ plantilla: t.id }"><nx-icon [name]="t.icon" [size]="12" />{{ t.label }}</a>
                }
              </span></li>
            <li><a routerLink="/workflows">Diseñe un flujo</a> que combine conectores, condiciones y agentes.</li>
            <li>Actívelo por <strong>webhook</strong>, <strong>cron</strong> o expóngalo vía <a routerLink="/admin/security">servidor MCP</a>.</li>
          </ol>
        </div>
        <div class="card">
          <div class="card-title"><h2>Ejecuciones recientes</h2><span class="spacer"></span><a routerLink="/executions" class="small">Ver todas</a></div>
          @if (executions().length) {
            <table class="table">
              <tbody>
                @for (e of executions(); track e.id) {
                  <tr class="clickable" [routerLink]="['/executions', e.id]">
                    <td>{{ e.workflow?.name }}</td>
                    <td><nx-status [status]="e.status" /></td>
                    <td class="muted small">{{ e.createdAt | ago }}</td>
                  </tr>
                }
              </tbody>
            </table>
          } @else {
            <div class="empty"><p>Aún no hay ejecuciones.</p></div>
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    .kpi { display: flex; gap: 14px; align-items: center; color: inherit; }
    .value { font-size: 26px; font-weight: 700; }
    .steps { margin: 0; padding-left: 20px; display: grid; gap: 10px; }
    .budget-card { display: flex; gap: 14px; align-items: center; color: inherit; padding: 14px 18px; }
    .budget-body { flex: 1; min-width: 0; display: grid; gap: 6px; }
    .budget-card .title, .budget-card .me { color: var(--text); }
    .go { transform: rotate(180deg); color: var(--muted); }
    .crit { margin-bottom: 16px; }
    .crit p { margin: 2px 0 6px; font-weight: 450; }
    .crit .grow { flex: 1; min-width: 0; }
    .crit-list { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px 16px; }
    .crit-list li { display: inline-flex; gap: 6px; align-items: baseline; }
    .crit-list a { font-weight: 650; color: var(--danger); text-decoration: underline; }
    .crit .score { font-size: 12px; font-variant-numeric: tabular-nums; }
    .tpls { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .tpls .badge { gap: 4px; }
  `,
})
export class DashboardPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly access = inject(AccessApi);
  protected readonly auth = inject(AuthService);
  /** Saludo dinámico del encabezado «hero»: incluye el nombre si hay sesión y el emoji. */
  readonly greeting = computed(() => {
    const me = this.auth.me();
    return `Hola${me ? ', ' + me.name : ''} 👋`;
  });
  readonly critical = signal<AgentHealthSummary[]>([]);
  readonly templates = INDUSTRY_TEMPLATES;
  readonly stats = signal<Stats | null>(null);
  readonly executions = signal<Execution[]>([]);
  readonly usage = signal<MyUsage | null>(null);
  readonly policyLabels = POLICY_LABELS;
  readonly periodLabel = periodLabel;
  readonly level = budgetLevel;

  kpis() {
    const s = this.stats();
    return [
      { label: 'Agentes', value: s?.agents ?? '—', icon: 'bot', link: '/agents' },
      { label: 'Conectores', value: s?.connectors ?? '—', icon: 'plug', link: '/connectors' },
      { label: 'Flujos', value: s?.workflows ?? '—', icon: 'flow', link: '/workflows' },
      { label: 'Ejecuciones (7 días)', value: s ? `${s.executionsLast7d} · ${s.failedLast7d} fallidas` : '—', icon: 'zap', link: '/executions' },
    ];
  }

  async ngOnInit() {
    // El consumo es complementario: si falla no debe impedir mostrar el resto del inicio.
    this.api.myUsage().then((u) => this.usage.set(u), () => this.usage.set(null));
    // Alertas de salud (ADR 0006 D5): complementarias, sin bloquear el inicio.
    this.access.healthSummary().then(
      (list) => this.critical.set(list.filter((h) => h.level === 'CRITICAL').sort((a, b) => a.score - b.score)),
      () => this.critical.set([]),
    );
    const [stats, ex] = await Promise.all([this.api.stats(), this.api.executions({ take: '6' })]);
    this.stats.set(stats);
    this.executions.set(ex.items);
  }
}
