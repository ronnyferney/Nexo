import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { Execution, Stats } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { StatusBadgeComponent } from '../../shared/status-badge.component';

@Component({
  selector: 'nx-dashboard',
  imports: [RouterLink, IconComponent, StatusBadgeComponent, RelativeTimePipe],
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

      <div class="grid grid-2" style="margin-top:16px">
        <div class="card">
          <div class="card-title"><h2>Primeros pasos</h2></div>
          <ol class="steps">
            <li><a routerLink="/connectors">Cree un conector</a> REST, SOAP, GraphQL o MCP e importe sus operaciones.</li>
            <li><a routerLink="/agents">Cree un agente</a>, asígnele herramientas y pruébelo en el chat.</li>
            <li><a routerLink="/workflows">Diseñe un flujo</a> que combine conectores, condiciones y agentes.</li>
            <li>Actívelo por <strong>webhook</strong>, <strong>cron</strong> o expóngalo vía <a routerLink="/settings">servidor MCP</a>.</li>
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
  `,
})
export class DashboardPage implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  readonly stats = signal<Stats | null>(null);
  readonly executions = signal<Execution[]>([]);

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
    const [stats, ex] = await Promise.all([this.api.stats(), this.api.executions({ take: '6' })]);
    this.stats.set(stats);
    this.executions.set(ex.items);
  }
}
