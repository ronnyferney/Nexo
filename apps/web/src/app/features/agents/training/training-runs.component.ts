import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, OnInit, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/api.service';
import type { ProviderInfo } from '../../../core/models';
import { TrainingApi } from '../../../core/training.api';
import { DEFAULT_PASS_THRESHOLD, type EvalRun } from '../../../core/training.models';
import { ToastService } from '../../../core/toast.service';
import { IconComponent } from '../../../shared/icon.component';
import { RelativeTimePipe } from '../../../shared/relative-time.pipe';
import { ScorePipe } from '../../../shared/score.pipe';
import { StatusBadgeComponent } from '../../../shared/status-badge.component';
import { UsdPipe } from '../../../shared/usd.pipe';
import { ModelSelectComponent } from './model-select.component';
import { TrainingRunDetailComponent } from './training-run-detail.component';
import { type ScorePoint, TrainingScoreChartComponent } from './training-score-chart.component';
import { defaultModelKey, formatDateTime, parseModelKey, versionLabel } from './training-utils';

const POLL_MS = 2000;
const SHORT_DATE = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Paso «Evaluar»: lanzar corridas con juez IA, evolución del puntaje, lista de corridas y detalle. */
@Component({
  selector: 'nx-training-runs',
  imports: [
    FormsModule,
    IconComponent,
    RelativeTimePipe,
    ScorePipe,
    StatusBadgeComponent,
    UsdPipe,
    ModelSelectComponent,
    TrainingRunDetailComponent,
    TrainingScoreChartComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      @if (canEdit()) {
        <section class="card stack" aria-labelledby="run-new-title">
          <div class="row wrap"><nx-icon name="beaker" [size]="16" /><h3 id="run-new-title">Ejecutar evaluación</h3></div>
          <div class="launch">
            <div class="field judge"><label for="judge-model">Modelo juez</label>
              <nx-model-select selectId="judge-model" [providers]="providers()" [(value)]="judgeKey" />
              <span class="hint">Se recomienda un modelo Premium como juez.</span></div>
            <div class="field thr"><label for="pass-thr">Umbral de aprobación: <strong>{{ threshold() | score }}</strong></label>
              <input id="pass-thr" type="range" min="0.5" max="0.95" step="0.05" [ngModel]="threshold()" (ngModelChange)="threshold.set(+$event)"
                [attr.aria-valuetext]="(threshold() | score)" />
              <span class="hint">Un caso aprueba si el puntaje es ≥ al umbral.</span></div>
            <div class="field note"><label for="run-note">Nota de versión (opcional)</label>
              <input id="run-note" class="input" [(ngModel)]="versionNote" maxlength="200" placeholder="Ej.: tono más formal" /></div>
          </div>
          <div class="callout warning"><nx-icon name="wallet" [size]="15" />
            <span>La evaluación ejecuta el agente sobre {{ caseCount() ?? 'todos los' }} {{ caseCount() === 1 ? 'caso' : 'casos' }} y califica cada salida con el juez: consume tokens del presupuesto del centro de costo del agente.</span></div>
          <div class="row wrap">
            @if (caseCount() === 0) { <span class="small muted">Cree al menos un caso de evaluación para ejecutar.</span> }
            <span class="spacer"></span>
            <button class="btn primary" [disabled]="starting() || !judgeKey() || caseCount() === 0" (click)="start()">
              <nx-icon name="play" [size]="15" />{{ starting() ? 'Encolando…' : 'Ejecutar evaluación' }}</button>
          </div>
        </section>
      }

      @if (points().length) {
        <section class="card stack" aria-labelledby="run-chart-title">
          <div class="row"><nx-icon name="chart" [size]="16" /><h3 id="run-chart-title">Evolución del puntaje</h3></div>
          <nx-training-score-chart [points]="points()" [target]="target()" [selected]="selectedId()" (pick)="select($event)" />
        </section>
      }

      <section class="card flush" aria-labelledby="run-list-title">
        <div class="row wrap head"><h3 id="run-list-title">Corridas</h3><span class="spacer"></span>
          <button class="btn sm" [disabled]="loading()" (click)="load()"><nx-icon name="refresh" [size]="14" />Actualizar</button></div>
        @if (loading() && !runs().length) {
          <p class="muted small pad">Cargando corridas…</p>
        } @else if (error() && !runs().length) {
          <div class="pad"><div class="callout danger"><nx-icon name="alert" [size]="15" /><span>{{ error() }}</span><button class="btn sm" (click)="load()">Reintentar</button></div></div>
        } @else if (!runs().length) {
          <div class="empty"><nx-icon name="beaker" [size]="32" /><h3>Sin evaluaciones</h3><p>Ejecute una evaluación para medir la calidad del agente.</p></div>
        } @else {
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Fecha</th><th>Versión</th><th>Estado</th><th class="num">Puntaje</th><th class="num">Aprobados</th><th class="num">Costo</th><th>Juez</th><th><span class="sr-only">Acciones</span></th></tr></thead>
              <tbody>
                @for (r of runs(); track r.id) {
                  <tr [class.selected]="selectedId() === r.id">
                    <td class="nowrap" [title]="fmt(r.createdAt)">{{ r.createdAt | ago }}</td>
                    <td>{{ vlabel(r.version) }}</td>
                    <td><nx-status [status]="r.status" /></td>
                    <td class="num"><strong [class.ok]="r.score !== null && r.score >= target()">{{ r.score | score }}</strong></td>
                    <td class="num">{{ r.passed }} / {{ r.total }}</td>
                    <td class="num">{{ r.costUsd | usd }}</td>
                    <td class="judge-c" [title]="r.judgeModel">{{ r.judgeModel }}</td>
                    <td class="nowrap"><button class="btn sm" [attr.aria-pressed]="selectedId() === r.id" (click)="select(r.id)"><nx-icon name="eye" [size]="14" />Detalle</button></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      @if (selectedId(); as id) {
        <nx-training-run-detail [runId]="id" [canEdit]="canEdit()" [providers]="providers()" (closed)="selectedId.set(null)"
          (finished)="changed.emit()" (suggestionCreated)="suggestionCreated.emit()" />
      }
    </div>
  `,
  styles: `
    .launch { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: start; }
    .thr input { width: 100%; accent-color: var(--primary); margin: 8px 0 2px; }
    .card.flush { padding: 0; overflow: hidden; }
    .head { padding: 14px 16px 6px; }
    .pad { padding: 0 16px 16px; }
    .judge-c { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
    strong.ok { color: var(--success); }
    @media (max-width: 900px) { .launch { grid-template-columns: 1fr; } }
  `,
})
export class TrainingRunsComponent implements OnInit {
  private readonly training = inject(TrainingApi);
  private readonly toast = inject(ToastService);
  readonly agentId = input.required<string>();
  readonly canEdit = input(false);
  readonly providers = input<ProviderInfo[]>([]);
  /** Meta 0–1. */
  readonly target = input(0.85);
  readonly caseCount = input<number | null>(null);
  readonly changed = output<void>();
  readonly suggestionCreated = output<void>();

  readonly runs = signal<EvalRun[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly starting = signal(false);
  readonly selectedId = signal<string | null>(null);
  readonly judgeKey = signal('');
  readonly threshold = signal(DEFAULT_PASS_THRESHOLD);
  versionNote = '';

  readonly points = computed<ScorePoint[]>(() =>
    this.runs()
      .filter((r) => r.status === 'SUCCEEDED' && r.score !== null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((r, i) => ({
        id: r.id,
        label: r.version !== null ? `v${r.version}` : `#${i + 1}`,
        score: r.score!,
        date: SHORT_DATE.format(new Date(r.createdAt)),
      })),
  );
  private readonly activeIds = computed(() => this.runs().filter((r) => r.status === 'QUEUED' || r.status === 'RUNNING').map((r) => r.id));
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    effect(() => {
      const p = this.providers();
      if (!untracked(this.judgeKey)) this.judgeKey.set(defaultModelKey(p));
    });
  }

  ngOnInit() {
    void this.load();
  }

  async load(silent = false) {
    clearTimeout(this.timer);
    if (!silent) this.loading.set(true);
    this.error.set(null);
    const before = new Set(this.activeIds());
    try {
      const runs = await this.training.evalRuns(this.agentId());
      this.runs.set([...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      const now = new Set(this.activeIds());
      if ([...before].some((id) => !now.has(id))) this.changed.emit();
    } catch (e) {
      if (!silent) this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
      // Sondeo cada 2 s mientras haya corridas en cola o en ejecución.
      if (this.activeIds().length) this.timer = setTimeout(() => void this.load(true), POLL_MS);
    }
  }

  async start() {
    const parsed = parseModelKey(this.judgeKey());
    if (!parsed) return;
    this.starting.set(true);
    try {
      const run = await this.training.startEvalRun(this.agentId(), {
        judgeProviderId: parsed.providerId,
        judgeModel: parsed.model,
        passThreshold: this.threshold(),
        versionNote: this.versionNote.trim() || undefined,
      });
      this.versionNote = '';
      this.toast.success('Evaluación encolada');
      if (run?.id) this.selectedId.set(run.id);
      this.changed.emit();
      await this.load(true);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.starting.set(false);
    }
  }

  select(id: string) {
    this.selectedId.set(this.selectedId() === id ? null : id);
    if (this.selectedId()) setTimeout(() => document.getElementById('run-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  vlabel(v: number | null) {
    return v === null ? '—' : versionLabel(v);
  }

  fmt(v: string) {
    return formatDateTime(v);
  }
}
