import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { errorMessage } from '../../core/api.service';
import { StudioApi } from '../../core/studio.api';
import type { RoutineRun } from '../../core/studio.models';
import { IconComponent } from '../../shared/icon.component';
import { DurationPipe, RelativeTimePipe } from '../../shared/relative-time.pipe';
import { StatusBadgeComponent } from '../../shared/status-badge.component';
import { UsdPipe } from '../../shared/usd.pipe';

/** Historial de ejecuciones de una rutina (`GET /routines/:id/runs`, últimas 50). */
@Component({
  selector: 'nx-routine-runs',
  imports: [IconComponent, StatusBadgeComponent, UsdPipe, RelativeTimePipe, DurationPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row head">
      <strong class="small">Historial de ejecuciones</strong><span class="spacer"></span>
      <button type="button" class="btn ghost sm" (click)="load()" [disabled]="loading()"><nx-icon name="refresh" [size]="14" />Actualizar</button>
    </div>
    @if (loading()) {
      <p class="muted small">Cargando historial…</p>
    } @else if (error()) {
      <div class="callout danger"><nx-icon name="alert" [size]="16" /><span>{{ error() }}</span></div>
    } @else {
      <div class="stack runs">
        @for (r of runs(); track r.id) {
          <details class="run">
            <summary>
              <nx-status [status]="r.status" />
              <span class="small">{{ r.startedAt | ago }}</span>
              <span class="small muted">{{ r.startedAt | duration: r.finishedAt }}</span>
              <span class="spacer"></span>
              <span class="small num" title="Costo de la ejecución">{{ r.costUsd | usd }}</span>
            </summary>
            @if (r.error) { <div class="callout danger small">{{ r.error }}</div> }
            @if (r.output) { <pre class="code-block">{{ r.output }}</pre> }
            @if (!r.error && !r.output) { <p class="muted small">Sin salida.</p> }
          </details>
        } @empty {
          <p class="muted small">Aún no hay ejecuciones.</p>
        }
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 8px; }
    .runs { gap: 6px; }
    .run { border: 1px solid var(--border); border-radius: 9px; padding: 8px 10px; }
    .run summary { display: flex; align-items: center; gap: 10px; cursor: pointer; flex-wrap: wrap; }
    .run .code-block, .run .callout { margin-top: 8px; }
  `,
})
export class RoutineRunsComponent {
  private readonly studio = inject(StudioApi);
  readonly routineId = input.required<string>();
  /** Cambie este valor para forzar la recarga (p. ej. tras «Ejecutar ahora»). */
  readonly refresh = input(0);
  readonly runs = signal<RoutineRun[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      this.routineId();
      this.refresh();
      untracked(() => void this.load());
    });
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.runs.set(await this.studio.routineRuns(this.routineId()));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
