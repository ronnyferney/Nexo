import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../core/api.service';
import type { Agent, AgentRun } from '../../core/models';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { StatusBadgeComponent } from '../../shared/status-badge.component';
import { UsdPipe } from '../../shared/usd.pipe';
import {
  type AgentRunFilters,
  buildRunsQuery,
  EMPTY_RUN_FILTERS,
  formatDuration,
  hasActiveFilters,
  RUN_SOURCES,
  RUN_STATUSES,
  sourceLabel,
} from './agent-runs.util';

/** Historial de tareas del agente (RX-14): lista paginada por cursor con filtros. Solo lectura. */
@Component({
  selector: 'nx-agent-runs',
  imports: [
    FormsModule,
    IconComponent,
    StatusBadgeComponent,
    UsdPipe,
    EmptyStateComponent,
    ErrorStateComponent,
    LoadingStateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div><h1>Historial de tareas</h1><p>Cada tarea ejecutada por tus agentes, con su estado, latencia y costo</p></div>
        <button class="btn icon" title="Actualizar" aria-label="Actualizar" [disabled]="loading()" (click)="reload()">
          <nx-icon name="refresh" />
        </button>
      </div>

      <div class="card filters">
        <label class="sr-only" for="run-agente">Filtrar por agente</label>
        <select id="run-agente" class="input" [(ngModel)]="filters.agentId" (ngModelChange)="reload()">
          <option value="">Todos los agentes</option>
          @for (a of agents(); track a.id) { <option [value]="a.id">{{ a.name }}</option> }
        </select>
        <label class="sr-only" for="run-estado">Filtrar por estado</label>
        <select id="run-estado" class="input" [(ngModel)]="filters.status" (ngModelChange)="reload()">
          <option value="">Todos los estados</option>
          @for (s of statuses; track s.value) { <option [value]="s.value">{{ s.label }}</option> }
        </select>
        <label class="sr-only" for="run-origen">Filtrar por origen</label>
        <select id="run-origen" class="input" [(ngModel)]="filters.source" (ngModelChange)="reload()">
          <option value="">Todos los orígenes</option>
          @for (o of sources; track o.value) { <option [value]="o.value">{{ o.label }}</option> }
        </select>
        <label class="field"><span class="muted small">Desde</span>
          <input class="input" type="date" [max]="filters.to || today" [(ngModel)]="filters.from" (ngModelChange)="reload()" />
        </label>
        <label class="field"><span class="muted small">Hasta</span>
          <input class="input" type="date" [min]="filters.from" [max]="today" [(ngModel)]="filters.to" (ngModelChange)="reload()" />
        </label>
        @if (hasFilters()) {
          <button class="btn ghost" (click)="clearFilters()"><nx-icon name="x" [size]="15" />Limpiar</button>
        }
      </div>

      @if (error()) {
        <nx-error-state title="No se pudo cargar el historial" message="{{ error() }}" (retry)="reload()" />
      } @else if (loading() && !items().length) {
        <nx-loading-state text="Cargando historial…" />
      } @else if (items().length) {
        <div class="card" style="padding:0">
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">Agente</th><th scope="col">Origen</th><th scope="col">Estado</th>
                  <th scope="col">Inicio</th><th scope="col">Duración</th><th scope="col">1er token</th>
                  <th scope="col">Costo</th><th scope="col">Modelo</th>
                </tr>
              </thead>
              <tbody>
                @for (r of items(); track r.id) {
                  <tr>
                    <td><strong>{{ r.agentName }}</strong></td>
                    <td><span class="badge">{{ source(r.source) }}</span></td>
                    <td><nx-status [status]="r.status" /></td>
                    <td class="muted small nowrap" [title]="full(r.startedAt)">{{ dt(r.startedAt) }}</td>
                    <td class="small nowrap">{{ dur(r.durationMs) }}</td>
                    <td class="small nowrap">{{ dur(r.ttftMs) }}</td>
                    <td class="small nowrap">{{ r.costUsd | usd }}</td>
                    <td class="small nowrap">{{ r.model || '—' }}</td>
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
          description="Ninguna tarea coincide con los filtros aplicados." actionLabel="Limpiar filtros" actionIcon="x"
          (action)="clearFilters()" />
      } @else {
        <nx-empty-state icon="history" title="Sin tareas aún"
          description="Cuando tus agentes ejecuten tareas (chat, flujos, rutinas…), aparecerán aquí." />
      }
    </div>
  `,
  styles: `
    .filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; margin-bottom: 16px; }
    .filters .input { width: 190px; max-width: 100%; }
    .filters .field { display: flex; flex-direction: column; gap: 3px; }
    .filters .field .input { width: 160px; }
    @media (max-width: 520px) { .filters .input, .filters .field, .filters .field .input { width: 100%; } }
  `,
})
export class AgentRunsPage implements OnInit {
  private readonly api = inject(ApiService);
  readonly items = signal<AgentRun[]>([]);
  readonly agents = signal<Agent[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  filters: AgentRunFilters = { ...EMPTY_RUN_FILTERS };
  readonly statuses = RUN_STATUSES;
  readonly sources = RUN_SOURCES;
  readonly today = new Date().toISOString().slice(0, 10);
  readonly source = sourceLabel;
  readonly dur = formatDuration;
  readonly hasFilters = computed(() => hasActiveFilters(this.filters));

  async ngOnInit() {
    try {
      this.agents.set(await this.api.agents());
    } catch {
      // El selector de agentes es secundario: si falla, el historial sigue siendo usable.
    }
    await this.reload();
  }

  dt(iso: string) {
    return new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
  }

  full(iso: string) {
    return new Date(iso).toLocaleString('es', { dateStyle: 'full', timeStyle: 'medium' });
  }

  clearFilters() {
    this.filters = { ...EMPTY_RUN_FILTERS };
    void this.reload();
  }

  async reload() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const r = await this.api.agentRuns(buildRunsQuery(this.filters));
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
      const r = await this.api.agentRuns(buildRunsQuery(this.filters, { cursor: this.nextCursor() }));
      this.items.update((i) => [...i, ...r.items]);
      this.nextCursor.set(r.nextCursor);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
