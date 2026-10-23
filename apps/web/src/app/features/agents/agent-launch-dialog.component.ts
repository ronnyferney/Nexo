import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccessApi } from '../../core/access.api';
import { type AgentHealth, LAUNCH_MIN_HEALTH } from '../../core/access.models';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { Agent } from '../../core/models';
import { TrainingApi } from '../../core/training.api';
import { DEFAULT_TARGET_SCORE, type TrainingSummary } from '../../core/training.models';
import { IconComponent } from '../../shared/icon.component';
import { ScorePipe } from '../../shared/score.pipe';

/** Extrae del error de la API la lista de requisitos incumplidos, si la incluye. */
function missingFrom(err: unknown): string[] {
  if (!(err instanceof HttpErrorResponse) || !err.error || typeof err.error !== 'object') return [];
  const body = err.error as Record<string, unknown>;
  const list = body['missing'] ?? body['reasons'] ?? body['requirements'];
  return Array.isArray(list) ? list.map((x) => (typeof x === 'string' ? x : String((x as { message?: string }).message ?? x))) : [];
}

/**
 * Lanzamiento con garantía de calidad (ADR 0006 D4): muestra los requisitos (salud ≥ 70 y última evaluación ≥ meta),
 * lanza y, si no se cumplen, permite a un ADMIN forzarlo con una razón obligatoria.
 */
@Component({
  selector: 'nx-agent-launch-dialog',
  imports: [FormsModule, IconComponent, ScorePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="modal" aria-labelledby="launch-title" (cancel)="onCancel($event)" (close)="closed.emit()">
      <form (ngSubmit)="submit()">
        <div class="modal-head">
          <div class="icon-tile"><nx-icon name="rocket" /></div>
          <div class="grow"><h2 id="launch-title">Lanzar «{{ agent().name }}»</h2>
            <span class="small muted">Un agente lanzado puede publicarse por MCP, ejecutar rutinas y compartirse con toda la empresa.</span></div>
        </div>
        <div class="modal-body">
          <h3 class="small muted">Requisitos de calidad</h3>
          <ul class="reqs">
            <li [class.ok]="healthOk()" [class.ko]="healthOk() === false">
              <nx-icon [name]="healthOk() ? 'checkCircle' : healthOk() === false ? 'alert' : 'clock'" [size]="17" />
              <span>Puntaje de salud de al menos {{ minHealth }}
                <span class="block small muted">{{ health() ? 'Actual: ' + health()!.score + ' / 100' : 'Sin dato de salud' }}</span></span>
            </li>
            <li [class.ok]="evalOk()" [class.ko]="evalOk() === false">
              <nx-icon [name]="evalOk() ? 'checkCircle' : evalOk() === false ? 'alert' : 'clock'" [size]="17" />
              <span>Última evaluación igual o superior a la meta ({{ target() | score }})
                <span class="block small muted">
                  @if (summaryError()) { No se pudo consultar: {{ summaryError() }} }
                  @else if (!summary()) { Consultando evaluaciones… }
                  @else if (summary()!.latestScore === null) { Aún no hay evaluaciones: ejecútelas en la pestaña Entrenamiento. }
                  @else { Última: {{ summary()!.latestScore | score }} }
                </span></span>
            </li>
          </ul>

          @if (error()) {
            <div class="callout danger" role="alert"><nx-icon name="alert" [size]="16" />
              <div><span>{{ error() }}</span>
                @if (missing().length) { <ul class="miss">@for (m of missing(); track m) { <li>{{ m }}</li> }</ul> }</div></div>
          }

          @if (auth.isAdmin() && (blocked() || error())) {
            <div class="override">
              <label class="checkbox"><input type="checkbox" name="override" [(ngModel)]="override" />
                <strong>Forzar el lanzamiento como administrador</strong></label>
              @if (override) {
                <div class="field"><label for="launch-reason">Razón (obligatoria, queda registrada)</label>
                  <textarea id="launch-reason" class="input" name="reason" rows="3" required [(ngModel)]="reason"
                    placeholder="Ej.: piloto controlado con el equipo de operaciones durante dos semanas"></textarea></div>
              }
            </div>
          } @else if (blocked()) {
            <p class="muted small m0">Complete los requisitos o pida a un administrador que fuerce el lanzamiento.</p>
          }
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" (click)="close()">Cancelar</button>
          <button type="submit" class="btn primary" [disabled]="busy() || (override && reason.trim().length < 5)">
            <nx-icon name="rocket" [size]="16" />{{ busy() ? 'Lanzando…' : override ? 'Forzar lanzamiento' : 'Lanzar' }}</button>
        </div>
      </form>
    </dialog>
  `,
  styles: `
    .grow { flex: 1; min-width: 0; }
    .m0 { margin: 0; }
    .reqs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .reqs li { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; }
    .reqs li nx-icon { color: var(--muted); margin-top: 1px; }
    .reqs li.ok nx-icon { color: var(--success); }
    .reqs li.ko { border-color: var(--warning); background: var(--warning-50); }
    .reqs li.ko nx-icon { color: var(--warning); }
    .miss { margin: 6px 0 0; padding-left: 18px; font-weight: 500; }
    .override { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px dashed var(--warning); border-radius: 10px; }
  `,
})
export class AgentLaunchDialogComponent implements OnInit {
  private readonly api = inject(AccessApi);
  private readonly training = inject(TrainingApi);
  protected readonly auth = inject(AuthService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  readonly agent = input.required<Agent>();
  readonly health = input<AgentHealth | null>(null);
  readonly launched = output<Agent>();
  readonly closed = output<void>();

  readonly minHealth = LAUNCH_MIN_HEALTH;
  readonly summary = signal<TrainingSummary | null>(null);
  readonly summaryError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly missing = signal<string[]>([]);
  override = false;
  reason = '';

  readonly target = computed(() => this.summary()?.targetScore ?? this.agent().targetScore ?? DEFAULT_TARGET_SCORE);
  readonly healthOk = computed(() => (this.health() ? this.health()!.score >= LAUNCH_MIN_HEALTH : null));
  readonly evalOk = computed(() => {
    const s = this.summary();
    if (!s) return null;
    return s.latestScore !== null && s.latestScore >= this.target();
  });
  readonly blocked = computed(() => this.healthOk() === false || this.evalOk() === false);

  constructor() {
    afterNextRender(() => this.dialog().nativeElement.showModal());
  }

  async ngOnInit() {
    try {
      this.summary.set(await this.training.summary(this.agent().id));
    } catch (e) {
      this.summaryError.set(errorMessage(e));
    }
  }

  onCancel(ev: Event) {
    if (this.busy()) ev.preventDefault();
  }

  close() {
    if (!this.busy()) this.dialog().nativeElement.close();
  }

  async submit() {
    if (this.busy()) return;
    if (this.override && this.reason.trim().length < 5) return;
    this.busy.set(true);
    this.error.set(null);
    this.missing.set([]);
    try {
      const agent = await this.api.launch(this.agent().id, this.override ? { override: true, reason: this.reason.trim() } : {});
      this.busy.set(false);
      this.launched.emit(agent);
      this.dialog().nativeElement.close();
    } catch (e) {
      this.error.set(errorMessage(e));
      this.missing.set(missingFrom(e));
      this.busy.set(false);
    }
  }
}
