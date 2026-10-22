import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import type { Execution, Workflow } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';
import { DurationPipe, RelativeTimePipe } from '../../shared/relative-time.pipe';
import { StatusBadgeComponent } from '../../shared/status-badge.component';

const TRIGGERS: Record<string, string> = { MANUAL: 'Manual', WEBHOOK: 'Webhook', SCHEDULE: 'Programado', AGENT: 'Agente', MCP: 'MCP' };

@Component({
  selector: 'nx-executions-list',
  imports: [FormsModule, RouterLink, IconComponent, StatusBadgeComponent, RelativeTimePipe, DurationPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div><h1>Ejecuciones</h1><p>Historial y trazabilidad de cada flujo ejecutado</p></div>
        <div class="row">
          <select class="input" style="width:220px" [(ngModel)]="workflowId" (ngModelChange)="reload()">
            <option value="">Todos los flujos</option>
            @for (w of workflows(); track w.id) { <option [value]="w.id">{{ w.name }}</option> }
          </select>
          <select class="input" style="width:160px" [(ngModel)]="status" (ngModelChange)="reload()">
            <option value="">Todos los estados</option>
            <option value="SUCCEEDED">Exitosas</option><option value="FAILED">Fallidas</option>
            <option value="RUNNING">Ejecutando</option><option value="QUEUED">En cola</option><option value="CANCELLED">Canceladas</option>
          </select>
          <button class="btn icon" title="Actualizar" (click)="reload()"><nx-icon name="refresh" /></button>
        </div>
      </div>
      <div class="card" style="padding:0">
        <table class="table">
          <thead><tr><th>Flujo</th><th>Estado</th><th>Disparador</th><th>Inicio</th><th>Duración</th><th>Error</th></tr></thead>
          <tbody>
            @for (e of items(); track e.id) {
              <tr class="clickable" [routerLink]="['/executions', e.id]">
                <td><strong>{{ e.workflow?.name }}</strong><div class="muted small mono">{{ e.id }}</div></td>
                <td><nx-status [status]="e.status" /></td>
                <td><span class="badge">{{ trigger(e.trigger) }}</span></td>
                <td class="muted small">{{ e.createdAt | ago }}</td>
                <td class="small">{{ e.startedAt | duration: e.finishedAt }}</td>
                <td class="error-text" style="max-width:280px">{{ e.error }}</td>
              </tr>
            } @empty {
              <tr><td colspan="6"><div class="empty">No hay ejecuciones para estos filtros.</div></td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (nextCursor()) { <div class="row" style="justify-content:center; margin-top:16px"><button class="btn" (click)="more()">Cargar más</button></div> }
    </div>
  `,
})
export class ExecutionsListPage implements OnInit {
  private readonly api = inject(ApiService);
  readonly items = signal<Execution[]>([]);
  readonly workflows = signal<Workflow[]>([]);
  readonly nextCursor = signal<string | null>(null);
  workflowId = '';
  status = '';

  async ngOnInit() {
    this.workflows.set(await this.api.workflows());
    await this.reload();
  }

  trigger(t: string) {
    return TRIGGERS[t] ?? t;
  }

  private params(cursor?: string) {
    const p: Record<string, string> = { take: '25' };
    if (this.workflowId) p['workflowId'] = this.workflowId;
    if (this.status) p['status'] = this.status;
    if (cursor) p['cursor'] = cursor;
    return p;
  }

  async reload() {
    const r = await this.api.executions(this.params());
    this.items.set(r.items);
    this.nextCursor.set(r.nextCursor);
  }

  async more() {
    const r = await this.api.executions(this.params(this.nextCursor()!));
    this.items.update((i) => [...i, ...r.items]);
    this.nextCursor.set(r.nextCursor);
  }
}
