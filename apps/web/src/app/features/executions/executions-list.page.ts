import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import type { Execution, Workflow } from '../../core/models';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { DurationPipe, RelativeTimePipe } from '../../shared/relative-time.pipe';
import { StatusBadgeComponent } from '../../shared/status-badge.component';
import { PageHeaderComponent } from '../../layout/page-header.component';

const TRIGGERS: Record<string, string> = { MANUAL: 'Manual', WEBHOOK: 'Webhook', SCHEDULE: 'Programado', AGENT: 'Agente', MCP: 'MCP' };

@Component({
  selector: 'nx-executions-list',
  imports: [
    FormsModule,
    RouterLink,
    IconComponent,
    StatusBadgeComponent,
    RelativeTimePipe,
    DurationPipe,
    EmptyStateComponent,
    ErrorStateComponent,
    LoadingStateComponent,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nx-page-header heading="Ejecuciones" description="Historial y trazabilidad de cada flujo ejecutado">
        <div actions class="row wrap">
          <label class="sr-only" for="exe-flujo">Filtrar por flujo</label>
          <select id="exe-flujo" class="input" style="width:220px" [(ngModel)]="workflowId" (ngModelChange)="reload()">
            <option value="">Todos los flujos</option>
            @for (w of workflows(); track w.id) { <option [value]="w.id">{{ w.name }}</option> }
          </select>
          <label class="sr-only" for="exe-estado">Filtrar por estado</label>
          <select id="exe-estado" class="input" style="width:160px" [(ngModel)]="status" (ngModelChange)="reload()">
            <option value="">Todos los estados</option>
            <option value="SUCCEEDED">Exitosas</option><option value="FAILED">Fallidas</option>
            <option value="RUNNING">Ejecutando</option><option value="QUEUED">En cola</option><option value="CANCELLED">Canceladas</option>
          </select>
          <button class="btn icon" title="Actualizar" aria-label="Actualizar" [disabled]="loading()" (click)="reload()"><nx-icon name="refresh" /></button>
        </div>
      </nx-page-header>

      @if (error()) {
        <nx-error-state title="No se pudieron cargar las ejecuciones" message="{{ error() }}" (retry)="reload()" />
      } @else if (loading() && !items().length) {
        <nx-loading-state text="Cargando ejecuciones…" />
      } @else if (items().length) {
        <div class="card" style="padding:0">
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">Flujo</th><th scope="col">Estado</th><th scope="col">Disparador</th>
                  <th scope="col">Inicio</th><th scope="col">Duración</th><th scope="col">Error</th>
                </tr>
              </thead>
              <tbody>
                @for (e of items(); track e.id) {
                  <tr class="clickable" [routerLink]="['/executions', e.id]">
                    <td><strong>{{ e.workflow?.name }}</strong><div class="muted small mono">{{ e.id }}</div></td>
                    <td><nx-status [status]="e.status" /></td>
                    <td><span class="badge">{{ trigger(e.trigger) }}</span></td>
                    <td class="muted small nowrap">{{ e.createdAt | ago }}</td>
                    <td class="small nowrap">{{ e.startedAt | duration: e.finishedAt }}</td>
                    <td class="error-text" style="max-width:280px">{{ e.error }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
        @if (nextCursor()) {
          <div class="row" style="justify-content:center; margin-top:16px">
            <button class="btn" [disabled]="loading()" (click)="more()">{{ loading() ? 'Cargando…' : 'Cargar más' }}</button>
          </div>
        }
      } @else if (hasFilters()) {
        <nx-empty-state icon="search" title="Sin resultados"
          description="Ninguna ejecución coincide con los filtros aplicados." actionLabel="Limpiar filtros" actionIcon="x"
          (action)="clearFilters()" />
      } @else {
        <nx-empty-state icon="zap" title="Sin ejecuciones"
          description="Aún no se ha ejecutado ningún flujo. El historial aparecerá aquí cuando se dispare el primero." />
      }
    </div>
  `,
})
export class ExecutionsListPage implements OnInit {
  private readonly api = inject(ApiService);
  readonly items = signal<Execution[]>([]);
  readonly workflows = signal<Workflow[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  workflowId = '';
  status = '';

  readonly hasFilters = computed(() => !!this.workflowId || !!this.status);

  async ngOnInit() {
    try {
      this.workflows.set(await this.api.workflows());
    } catch {
      // El selector de flujos es secundario: si falla, el listado sigue siendo usable.
    }
    await this.reload();
  }

  trigger(t: string) {
    return TRIGGERS[t] ?? t;
  }

  clearFilters() {
    this.workflowId = '';
    this.status = '';
    void this.reload();
  }

  private params(cursor?: string) {
    const p: Record<string, string> = { take: '25' };
    if (this.workflowId) p['workflowId'] = this.workflowId;
    if (this.status) p['status'] = this.status;
    if (cursor) p['cursor'] = cursor;
    return p;
  }

  async reload() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const r = await this.api.executions(this.params());
      this.items.set(r.items);
      this.nextCursor.set(r.nextCursor);
    } catch (e) {
      this.items.set([]);
      this.nextCursor.set(null);
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async more() {
    this.loading.set(true);
    try {
      const r = await this.api.executions(this.params(this.nextCursor()!));
      this.items.update((i) => [...i, ...r.items]);
      this.nextCursor.set(r.nextCursor);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
