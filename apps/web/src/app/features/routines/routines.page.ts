import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { AgentsScopeApi } from '../../core/agents-scope.api';
import { AuthService } from '../../core/auth.service';
import type { Agent } from '../../core/models';
import { StudioApi } from '../../core/studio.api';
import type { Routine, RoutineRun } from '../../core/studio.models';
import { ToastService } from '../../core/toast.service';
import { canWriteAgent } from '../../shared/agent-permissions';
import { describeCron } from '../../shared/cron';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { StatusBadgeComponent } from '../../shared/status-badge.component';
import { UsdPipe } from '../../shared/usd.pipe';
import { RoutineRunsComponent } from './routine-runs.component';

const DATE_TIME = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });

@Component({
  selector: 'nx-routines',
  imports: [FormsModule, RouterLink, IconComponent, StatusBadgeComponent, RelativeTimePipe, UsdPipe, RoutineRunsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div><h1>Rutinas</h1><p>Tareas programadas de todos los agentes del espacio de trabajo</p></div>
        <div class="row wrap tools">
          <label class="sr-only" for="rt-filter">Filtrar</label>
          <input id="rt-filter" class="input filter" type="search" placeholder="Buscar por rutina o agente…" [ngModel]="filter()" (ngModelChange)="filter.set($event)" />
          <button class="btn" (click)="load()" [disabled]="loading()"><nx-icon name="refresh" [size]="15" />Actualizar</button>
        </div>
      </div>

      @if (loading() && !routines().length) {
        <div class="card empty"><p>Cargando rutinas…</p></div>
      } @else if (error()) {
        <div class="card empty"><nx-icon name="alert" [size]="28" /><h3>No se pudieron cargar las rutinas</h3><p>{{ error() }}</p>
          <button class="btn" (click)="load()">Reintentar</button></div>
      } @else if (!routines().length) {
        <div class="card empty"><nx-icon name="calendar" [size]="36" /><h3>Sin rutinas</h3>
          <p>Las rutinas se crean desde la pestaña «Rutinas» de cada <a routerLink="/agents">agente</a>.</p></div>
      } @else {
        <div class="card flush">
          <div class="table-wrap">
            <table class="table">
              <thead><tr>
                <th>Rutina</th><th>Agente</th><th>Frecuencia</th><th>Última ejecución</th><th>Próxima</th><th>Habilitada</th><th><span class="sr-only">Acciones</span></th>
              </tr></thead>
              <tbody>
                @for (r of visible(); track r.id) {
                  <tr>
                    <td class="name"><strong>{{ r.name }}</strong><span class="muted small block clamp" [title]="r.prompt">{{ r.prompt }}</span></td>
                    <td class="nowrap"><a [routerLink]="['/agents', r.agentId]" [queryParams]="{ tab: 'routines' }"><nx-icon name="bot" [size]="14" /> {{ r.agentName }}</a></td>
                    <td><span class="block">{{ describe(r.schedule) }}</span><span class="small muted"><code>{{ r.schedule }}</code> · {{ r.timezone }}</span></td>
                    <td class="nowrap">
                      @if (r.lastRunAt) { <span class="block small" [title]="fmt(r.lastRunAt)">{{ r.lastRunAt | ago }}</span> } @else { <span class="muted small">Nunca</span> }
                      @if (r.lastStatus) { <nx-status [status]="r.lastStatus" /> }
                    </td>
                    <td class="nowrap small" [title]="r.nextRunAt ? fmt(r.nextRunAt) : ''">{{ r.enabled && r.nextRunAt ? (r.nextRunAt | ago) : '—' }}</td>
                    <td>
                      <label class="switch" [title]="!canManage(r) ? 'Requiere permiso de edición sobre el agente' : r.enabled ? 'Deshabilitar' : 'Habilitar'">
                        <input type="checkbox" role="switch" [checked]="r.enabled" [disabled]="!canManage(r) || toggling().has(r.id)"
                          [attr.aria-label]="(r.enabled ? 'Deshabilitar ' : 'Habilitar ') + r.name" (change)="toggle(r, $any($event.target))" />
                        <span></span>
                      </label>
                    </td>
                    <td class="nowrap actions">
                      @if (canManage(r)) {
                        <button class="btn sm" [disabled]="running().has(r.id)" (click)="run(r)"><nx-icon name="play" [size]="14" />{{ running().has(r.id) ? 'Ejecutando…' : 'Ejecutar' }}</button>
                      }
                      <button class="btn ghost icon sm" [title]="expanded() === r.id ? 'Ocultar historial' : 'Ver historial'" [attr.aria-expanded]="expanded() === r.id"
                        [attr.aria-label]="'Historial de ' + r.name" (click)="expanded.set(expanded() === r.id ? null : r.id)"><nx-icon name="history" [size]="15" /></button>
                    </td>
                  </tr>
                  @if (results()[r.id] || expanded() === r.id) {
                    <tr class="detail"><td colspan="7">
                      @if (results()[r.id]; as res) {
                        <div class="callout" [class.danger]="res.status === 'FAILED'" role="status">
                          <div class="stack grow">
                            <div class="row wrap"><strong>Resultado de la ejecución</strong><nx-status [status]="res.status" /><span class="small">Costo {{ res.costUsd | usd }}</span>
                              <span class="spacer"></span><button class="btn ghost icon sm" title="Cerrar" aria-label="Cerrar resultado" (click)="clearResult(r.id)"><nx-icon name="x" [size]="14" /></button></div>
                            @if (res.error) { <span>{{ res.error }}</span> }
                            @if (res.output) { <pre class="code-block">{{ res.output }}</pre> }
                          </div>
                        </div>
                      }
                      @if (expanded() === r.id) { <nx-routine-runs [routineId]="r.id" [refresh]="runsVersion()" /> }
                    </td></tr>
                  }
                } @empty {
                  <tr><td colspan="7" class="muted small center">Ninguna rutina coincide con «{{ filter() }}».</td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .filter { width: 260px; max-width: 100%; }
    .card.flush { padding: 0; overflow: hidden; }
    .name { min-width: 200px; max-width: 340px; }
    .clamp { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .actions { text-align: right; }
    .actions .btn { margin-left: 4px; }
    .btn.icon.sm { width: 30px; }
    tr.detail td { background: var(--surface-2); }
    .grow { flex: 1; min-width: 0; }
    .center { text-align: center; }
    code { font-size: 11.5px; }
    @media (max-width: 640px) { .tools { width: 100%; } .filter { flex: 1 1 160px; width: auto; } }
  `,
})
export class RoutinesPage implements OnInit {
  private readonly studio = inject(StudioApi);
  private readonly agentsApi = inject(AgentsScopeApi);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  readonly routines = signal<Routine[]>([]);
  /** Agentes sobre los que el usuario puede escribir: ejecutar y habilitar exigen EDIT sobre el agente (ADR 0007). */
  readonly editableAgents = signal(new Set<string>());
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly filter = signal('');
  readonly toggling = signal(new Set<string>());
  readonly running = signal(new Set<string>());
  readonly results = signal<Record<string, RoutineRun>>({});
  readonly expanded = signal<string | null>(null);
  readonly runsVersion = signal(0);
  readonly visible = computed(() => {
    const q = this.filter().trim().toLowerCase();
    const list = this.routines();
    return q ? list.filter((r) => r.name.toLowerCase().includes(q) || r.agentName.toLowerCase().includes(q)) : list;
  });
  describe = describeCron;

  ngOnInit() {
    void this.load();
  }

  canManage(r: Routine) {
    return this.editableAgents().has(r.agentId);
  }

  fmt(iso: string) {
    return DATE_TIME.format(new Date(iso));
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [routines, agents] = await Promise.all([
        this.studio.routines(),
        // La administración ve todas las rutinas: necesita también los agentes ajenos (`scope=all`, ADMIN_VIEW).
        this.agentsApi.agents(this.auth.isAdmin() ? 'all' : undefined).catch(() => [] as Agent[]),
      ]);
      const role = this.auth.session()?.role;
      this.editableAgents.set(new Set(agents.filter((a) => canWriteAgent(a.myPermission, role, a.visibility)).map((a) => a.id)));
      this.routines.set(routines);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  private setFlag(sig: typeof this.running, id: string, on: boolean) {
    const next = new Set(sig());
    if (on) next.add(id);
    else next.delete(id);
    sig.set(next);
  }

  async toggle(r: Routine, el: HTMLInputElement) {
    const enabled = el.checked;
    this.setFlag(this.toggling, r.id, true);
    try {
      const updated = await this.studio.updateRoutine(r.id, { enabled });
      this.routines.update((list) => list.map((x) => (x.id === r.id ? { ...x, ...updated } : x)));
      this.toast.success(enabled ? 'Rutina habilitada' : 'Rutina deshabilitada');
    } catch (e) {
      el.checked = !enabled;
      this.toast.error(errorMessage(e));
    } finally {
      this.setFlag(this.toggling, r.id, false);
    }
  }

  async run(r: Routine) {
    this.setFlag(this.running, r.id, true);
    try {
      const res = await this.studio.runRoutine(r.id);
      this.results.update((m) => ({ ...m, [r.id]: res }));
      this.runsVersion.update((v) => v + 1);
      this.routines.update((list) =>
        list.map((x) => (x.id === r.id ? { ...x, lastRunAt: res.startedAt, lastStatus: res.status } : x)),
      );
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.setFlag(this.running, r.id, false);
    }
  }

  clearResult(id: string) {
    this.results.update((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
  }
}
