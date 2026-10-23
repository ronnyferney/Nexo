import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { errorMessage } from '../../core/api.service';
import { StudioApi } from '../../core/studio.api';
import type { Routine, RoutineRun } from '../../core/studio.models';
import { ToastService } from '../../core/toast.service';
import { describeCron } from '../../shared/cron';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { StatusBadgeComponent } from '../../shared/status-badge.component';
import { UsdPipe } from '../../shared/usd.pipe';
import { RoutineEditorComponent } from '../routines/routine-editor.component';
import { RoutineRunsComponent } from '../routines/routine-runs.component';

/** Pestaña «Rutinas» del detalle de agente: tareas programadas, ejecución inmediata e historial. */
@Component({
  selector: 'nx-agent-routines',
  imports: [IconComponent, StatusBadgeComponent, RelativeTimePipe, UsdPipe, RoutineEditorComponent, RoutineRunsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      <div class="row wrap">
        <p class="muted small grow">Tareas que el agente ejecuta solo, según un horario. El consumo se imputa a su centro de costo.</p>
        @if (canEdit() && editing() === null) {
          <button class="btn primary sm" (click)="editing.set('new')"><nx-icon name="plus" [size]="14" />Nueva rutina</button>
        }
      </div>

      @if (editing() === 'new') {
        <nx-routine-editor [agentId]="agentId()" (saved)="onSaved()" (cancelled)="editing.set(null)" />
      }

      @if (loading()) {
        <div class="card empty"><p>Cargando rutinas…</p></div>
      } @else if (error()) {
        <div class="card empty"><nx-icon name="alert" [size]="28" /><h3>No se pudieron cargar las rutinas</h3><p>{{ error() }}</p>
          <button class="btn" (click)="load()">Reintentar</button></div>
      } @else {
        @for (r of routines(); track r.id) {
          @if (editing() === r.id) {
            <nx-routine-editor [agentId]="agentId()" [routine]="r" (saved)="onSaved()" (cancelled)="editing.set(null)" />
          } @else {
            <div class="card stack">
              <div class="row wrap">
                <nx-icon name="calendar" [size]="16" /><strong>{{ r.name }}</strong>
                <span class="badge" [class.success]="r.enabled">{{ r.enabled ? 'Habilitada' : 'Deshabilitada' }}</span>
                <span class="spacer"></span>
                @if (canEdit()) {
                  <button class="btn sm" [disabled]="running() === r.id" (click)="run(r)"><nx-icon name="play" [size]="14" />{{ running() === r.id ? 'Ejecutando…' : 'Ejecutar ahora' }}</button>
                  <button class="btn ghost icon sm" title="Editar" aria-label="Editar rutina" (click)="editing.set(r.id)"><nx-icon name="pencil" [size]="15" /></button>
                  <button class="btn ghost icon sm danger" title="Eliminar" aria-label="Eliminar rutina" (click)="remove(r)"><nx-icon name="trash" [size]="15" /></button>
                }
              </div>
              <div class="row wrap small muted">
                <span><nx-icon name="clock" [size]="13" /> {{ describe(r.schedule) }}</span>
                <code>{{ r.schedule }}</code><span>{{ r.timezone }}</span>
                <span>Próxima: {{ r.nextRunAt ? (r.nextRunAt | ago) : '—' }}</span>
                @if (r.lastStatus) { <span>Última: {{ r.lastRunAt | ago }}</span><nx-status [status]="r.lastStatus" /> }
              </div>
              <p class="small prompt">{{ r.prompt }}</p>
              @if (results()[r.id]; as res) {
                <div class="callout" [class.danger]="res.status === 'FAILED'" role="status">
                  <div class="stack grow">
                    <div class="row wrap"><nx-status [status]="res.status" /><span class="small">Costo {{ res.costUsd | usd }}</span></div>
                    @if (res.error) { <span>{{ res.error }}</span> }
                    @if (res.output) { <pre class="code-block">{{ res.output }}</pre> }
                  </div>
                </div>
              }
              <details (toggle)="toggleRuns(r.id, $any($event.target).open)">
                <summary class="small">Ver historial</summary>
                @if (openRuns().has(r.id)) { <nx-routine-runs [routineId]="r.id" [refresh]="runsVersion()" /> }
              </details>
            </div>
          }
        } @empty {
          @if (editing() !== 'new') {
            <div class="card empty"><nx-icon name="calendar" [size]="32" /><h3>Sin rutinas</h3>
              <p>Programe tareas recurrentes, como un reporte cada mañana.</p></div>
          }
        }
      }
    </div>
  `,
  styles: `
    .grow { flex: 1; min-width: 0; margin: 0; }
    .prompt { margin: 0; white-space: pre-wrap; color: var(--text); }
    details summary { cursor: pointer; color: var(--primary); }
    details[open] summary { margin-bottom: 8px; }
    code { background: var(--surface-2); padding: 0 6px; border-radius: 6px; }
  `,
})
export class AgentRoutinesComponent implements OnInit {
  private readonly studio = inject(StudioApi);
  private readonly toast = inject(ToastService);
  readonly agentId = input.required<string>();
  readonly canEdit = input(false);

  readonly routines = signal<Routine[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly editing = signal<string | null>(null);
  readonly running = signal<string | null>(null);
  readonly results = signal<Record<string, RoutineRun>>({});
  readonly openRuns = signal(new Set<string>());
  readonly runsVersion = signal(0);
  describe = describeCron;

  ngOnInit() {
    void this.load();
  }

  async load(silent = false) {
    if (!silent) this.loading.set(true);
    this.error.set(null);
    try {
      this.routines.set(await this.studio.agentRoutines(this.agentId()));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  onSaved() {
    this.editing.set(null);
    void this.load(true);
  }

  toggleRuns(id: string, open: boolean) {
    const next = new Set(this.openRuns());
    if (open) next.add(id);
    else next.delete(id);
    this.openRuns.set(next);
  }

  async run(r: Routine) {
    this.running.set(r.id);
    try {
      const res = await this.studio.runRoutine(r.id);
      this.results.update((m) => ({ ...m, [r.id]: res }));
      this.runsVersion.update((v) => v + 1);
      void this.load(true);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.running.set(null);
    }
  }

  async remove(r: Routine) {
    if (!confirm(`¿Eliminar la rutina «${r.name}» y su historial?`)) return;
    try {
      await this.studio.deleteRoutine(r.id);
      this.toast.success('Rutina eliminada');
      this.routines.update((list) => list.filter((x) => x.id !== r.id));
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
