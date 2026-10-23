import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { Execution, MyUsage, Stats } from '../../core/models';
import { budgetLevel, periodLabel, POLICY_LABELS } from '../../shared/budget';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { ProgressBarComponent } from '../../shared/progress-bar.component';
import { StatusBadgeComponent } from '../../shared/status-badge.component';
import { NumberPipe, UsdPipe } from '../../shared/usd.pipe';

@Component({
  selector: 'nx-dashboard',
  imports: [RouterLink, IconComponent, StatusBadgeComponent, RelativeTimePipe, ProgressBarComponent, UsdPipe, NumberPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div><h1>Hola{{ auth.me() ? ', ' + auth.me()!.name : '' }} 👋</h1><p>Resumen de su plataforma de agentes y automatización</p></div>
      </div>

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
            <li><a routerLink="/agents">Cree un agente</a>, asígnele herramientas y pruébelo en el chat.</li>
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
  `,
})
export class DashboardPage implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
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
    const [stats, ex] = await Promise.all([this.api.stats(), this.api.executions({ take: '6' })]);
    this.stats.set(stats);
    this.executions.set(ex.items);
  }
}
