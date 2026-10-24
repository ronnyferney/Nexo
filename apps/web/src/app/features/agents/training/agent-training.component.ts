import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, OnInit, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../../core/api.service';
import type { Agent, ProviderInfo } from '../../../core/models';
import { TrainingApi } from '../../../core/training.api';
import type { TrainingSummary } from '../../../core/training.models';
import { IconComponent } from '../../../shared/icon.component';
import { ProgressBarComponent } from '../../../shared/progress-bar.component';
import { formatScore as pct, ScorePipe } from '../../../shared/score.pipe';
import { TrainingCasesComponent } from './training-cases.component';
import { TrainingFeedbackComponent } from './training-feedback.component';
import { TrainingRunsComponent } from './training-runs.component';
import { TrainingSuggestionsComponent } from './training-suggestions.component';
import { TrainingVersionsComponent } from './training-versions.component';
import { versionLabel } from './training-utils';

export type TrainingSection = 'feedback' | 'cases' | 'runs' | 'suggestions' | 'versions';

/**
 * Pestaña «Entrenamiento» (ADR 0004): ciclo Supervisar → Casos → Evaluar → Mejorar → Publicar con contadores
 * de `GET /agents/:id/training-summary`, la meta de calidad y una sección por paso.
 */
@Component({
  selector: 'nx-agent-training',
  imports: [
    FormsModule,
    IconComponent,
    ProgressBarComponent,
    ScorePipe,
    TrainingFeedbackComponent,
    TrainingCasesComponent,
    TrainingRunsComponent,
    TrainingSuggestionsComponent,
    TrainingVersionsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      <section class="card cycle-card" aria-labelledby="cycle-title">
        <div class="row wrap head">
          <nx-icon name="repeat" [size]="16" /><h3 id="cycle-title">Ciclo de mejora</h3>
          @if (reached()) { <span class="badge success"><nx-icon name="target" [size]="12" />Meta alcanzada</span> }
          <span class="spacer"></span>
          @if (summaryError()) {
            <span class="small error-text" role="alert">No se pudo cargar el resumen</span>
            <button class="btn sm" (click)="loadSummary()">Reintentar</button>
          } @else if (!summary()) { <span class="muted small">Cargando resumen…</span> }
        </div>
        <ol class="cycle">
          @for (s of steps(); track s.id; let i = $index, last = $last) {
            <li>
              <button type="button" class="step" [class.active]="section() === s.id" [attr.aria-current]="section() === s.id ? 'step' : null"
                [attr.aria-controls]="'tsec-' + s.id" (click)="section.set(s.id)">
                <span class="lbl"><span class="n" aria-hidden="true">{{ i + 1 }}</span><strong>{{ s.label }}</strong></span>
                <span class="small muted detail">{{ s.detail }}</span>
                @if (s.alert) { <span class="dot-alert" aria-hidden="true"></span> }
              </button>
              @if (s.id === 'runs') {
                <div class="score-bar">
                  <nx-progress tone="quality" [pct]="latestPct()" [target]="targetPct()"
                    [label]="'Último puntaje ' + (summary()?.latestScore | score) + ' frente a la meta de ' + (targetScore() | score)" />
                </div>
              }
              @if (!last) { <span class="arrow" aria-hidden="true">→</span> }
            </li>
          }
        </ol>
        <div class="row wrap goal">
          <div class="field goal-f">
            <label for="target-score">Meta de calidad (%)</label>
            <input id="target-score" class="input" type="number" min="50" max="100" step="1" [disabled]="!canEdit()"
              [ngModel]="targetPctInput()" (ngModelChange)="setTarget($event)" [class.invalid]="targetInvalid()" aria-describedby="target-hint" />
          </div>
          <span class="hint small muted" id="target-hint">
            @if (targetInvalid()) { <span class="error-text">Ingrese un valor entre 50 y 100.</span> }
            @else { Puntaje que indica que el ciclo alcanzó el objetivo. Se guarda con el botón «Guardar». }
          </span>
        </div>
      </section>

      <div [id]="'tsec-' + section()" role="region" [attr.aria-label]="currentLabel()">
        @switch (section()) {
          @case ('feedback') { <nx-training-feedback [agentId]="agent().id" [canEdit]="canEdit()" (changed)="loadSummary()" /> }
          @case ('cases') { <nx-training-cases [agentId]="agent().id" [canEdit]="canEdit()" (changed)="loadSummary()" /> }
          @case ('runs') {
            <nx-training-runs [agentId]="agent().id" [canEdit]="canEdit()" [providers]="providers()" [target]="targetScore()"
              [caseCount]="summary()?.evalCases ?? null" (changed)="loadSummary()" (suggestionCreated)="section.set('suggestions')" />
          }
          @case ('suggestions') {
            <nx-training-suggestions [agent]="agent()" [canEdit]="canEdit()" [dirty]="dirty()" (applied)="onAgentChanged()" (reevaluate)="section.set('runs')" />
          }
          @case ('versions') {
            <nx-training-versions [agentId]="agent().id" [canEdit]="canEdit()" [dirty]="dirty()" (published)="onAgentChanged()" (changed)="loadSummary()" />
          }
        }
      </div>
    </div>
  `,
  styles: `
    .cycle-card { padding: 16px; }
    .head { margin-bottom: 12px; gap: 8px; }
    .cycle { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 16px; }
    .cycle li { position: relative; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .step { position: relative; display: flex; flex-direction: column; gap: 4px; width: 100%; text-align: left; padding: 9px 8px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: inherit; font: inherit; cursor: pointer; min-height: 64px; }
    .step:hover { border-color: var(--primary); }
    .step.active { border-color: var(--primary); background: var(--primary-50); }
    .n { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700; background: var(--surface-2); color: var(--muted); flex-shrink: 0; }
    .step.active .n { background: var(--primary-solid); color: var(--on-primary); }
    .lbl { display: flex; align-items: center; gap: 5px; font-size: 13px; padding-right: 4px; }
    .detail { line-height: 1.3; }
    .dot-alert { position: absolute; top: 4px; right: 4px; width: 8px; height: 8px; border-radius: 50%; background: var(--warning); }
    .arrow { position: absolute; right: -13px; top: 20px; color: var(--muted); font-weight: 700; }
    .score-bar { padding: 0 2px; }
    .goal { margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--border); align-items: flex-end; }
    .goal-f { width: 150px; }
    .goal .hint { flex: 1; min-width: 200px; padding-bottom: 9px; }
    @media (max-width: 1280px) and (min-width: 1101px), (max-width: 760px) {
      .cycle { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
      .arrow { display: none; }
    }
  `,
})
export class AgentTrainingComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly training = inject(TrainingApi);
  readonly agent = input.required<Agent>();
  readonly canEdit = input(false);
  readonly dirty = input(false);
  /** Meta de calidad 0.5–1, ligada al formulario del agente. */
  readonly targetScore = model(0.85);
  readonly agentChanged = output<void>();

  readonly section = signal<TrainingSection>('feedback');
  readonly summary = signal<TrainingSummary | null>(null);
  readonly summaryError = signal<string | null>(null);
  readonly providers = signal<ProviderInfo[]>([]);
  readonly targetInvalid = signal(false);
  readonly targetPctInput = signal(85);

  readonly targetPct = computed(() => Math.round(this.targetScore() * 100));
  readonly latestPct = computed(() => {
    const s = this.summary()?.latestScore;
    return s === null || s === undefined ? 0 : s * 100;
  });
  readonly reached = computed(() => {
    const s = this.summary()?.latestScore;
    return s !== null && s !== undefined && s >= this.targetScore();
  });
  readonly steps = computed(() => {
    const s = this.summary();
    const n = (v: number | undefined, one: string, many: string) => (v === undefined ? '…' : `${v} ${v === 1 ? one : many}`);
    const best = s ? (s.bestScore !== null ? `${versionLabel(s.bestVersion)} · ${pct(s.bestScore)}` : 'Sin puntaje aún') : '…';
    return [
      { id: 'feedback' as const, label: 'Supervisar', detail: n(s?.pendingFeedback, 'pendiente', 'pendientes'), alert: !!s?.pendingFeedback },
      { id: 'cases' as const, label: 'Casos', detail: n(s?.evalCases, 'caso', 'casos'), alert: false },
      {
        id: 'runs' as const,
        label: 'Evaluar',
        detail: s ? `Último ${pct(s.latestScore)} · meta ${pct(this.targetScore())}` : '…',
        alert: false,
      },
      { id: 'suggestions' as const, label: 'Mejorar', detail: n(s?.examples, 'ejemplo', 'ejemplos'), alert: false },
      { id: 'versions' as const, label: 'Publicar', detail: `Mejor: ${best}`, alert: false },
    ];
  });
  readonly currentLabel = computed(() => this.steps().find((s) => s.id === this.section())?.label ?? '');

  constructor() {
    // Sincroniza el campo con la meta del agente (p. ej. tras publicar una versión o recargar).
    effect(() => {
      const t = this.targetPct();
      untracked(() => {
        if (!this.targetInvalid() && this.targetPctInput() !== t) this.targetPctInput.set(t);
      });
    });
  }

  ngOnInit() {
    void this.loadSummary();
    this.api
      .llmCatalog()
      .catch(() => this.api.providers())
      .then((p) => this.providers.set(p))
      .catch(() => this.providers.set([]));
  }

  async loadSummary() {
    this.summaryError.set(null);
    try {
      this.summary.set(await this.training.summary(this.agent().id));
    } catch (e) {
      this.summaryError.set(errorMessage(e));
    }
  }

  setTarget(value: number | string | null) {
    const v = typeof value === 'string' ? Number(value) : value;
    this.targetPctInput.set(v ?? 0);
    const ok = typeof v === 'number' && !Number.isNaN(v) && v >= 50 && v <= 100;
    this.targetInvalid.set(!ok);
    if (ok) this.targetScore.set(Math.round(v) / 100);
  }

  onAgentChanged() {
    this.agentChanged.emit();
    void this.loadSummary();
  }
}
