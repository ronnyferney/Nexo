import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/api.service';
import type { ProviderInfo } from '../../../core/models';
import { TrainingApi } from '../../../core/training.api';
import type { EvalResult, EvalRunDetail } from '../../../core/training.models';
import { ToastService } from '../../../core/toast.service';
import { IconComponent } from '../../../shared/icon.component';
import { ScorePipe } from '../../../shared/score.pipe';
import { StatusBadgeComponent } from '../../../shared/status-badge.component';
import { UsdPipe } from '../../../shared/usd.pipe';
import { EvalResultItemComponent } from './eval-result-item.component';
import { ModelSelectComponent } from './model-select.component';
import { defaultModelKey, formatDateTime, parseModelKey, versionLabel } from './training-utils';

const POLL_MS = 2000;

/** Detalle de una corrida: resultados por caso con filtro de dudosos/fallidos y «Sugerir mejoras con IA». */
@Component({
  selector: 'nx-training-run-detail',
  imports: [FormsModule, IconComponent, ScorePipe, StatusBadgeComponent, UsdPipe, EvalResultItemComponent, ModelSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card stack" aria-labelledby="run-detail-title" id="run-detail">
      <div class="row wrap">
        <h3 id="run-detail-title">Detalle de la corrida</h3>
        @if (run(); as r) {
          <nx-status [status]="r.status" />
          <span class="badge">{{ vlabel(r.version) }}</span>
        }
        <span class="spacer"></span>
        <button class="btn ghost icon sm" title="Cerrar detalle" aria-label="Cerrar detalle" (click)="closed.emit()"><nx-icon name="x" [size]="15" /></button>
      </div>

      @if (loading() && !run()) {
        <p class="muted small">Cargando corrida…</p>
      } @else if (error() && !run()) {
        <div class="callout danger"><nx-icon name="alert" [size]="15" /><span>{{ error() }}</span><button class="btn sm" (click)="load()">Reintentar</button></div>
      } @else if (run(); as r) {
        <dl class="facts">
          <div><dt>Puntaje</dt><dd>{{ r.score | score }}</dd></div>
          <div><dt>Aprobados</dt><dd>{{ r.passed }} / {{ r.total }}</dd></div>
          <div><dt>Costo</dt><dd>{{ r.costUsd | usd }}</dd></div>
          <div><dt>Juez</dt><dd class="ell" [title]="r.judgeModel">{{ r.judgeModel }}</dd></div>
          @if (r.passThreshold !== undefined) { <div><dt>Umbral</dt><dd>{{ r.passThreshold | score }}</dd></div> }
          <div><dt>Inicio</dt><dd>{{ fmt(r.createdAt) }}</dd></div>
        </dl>
        @if (r.error) { <div class="callout danger"><nx-icon name="alert" [size]="15" /><span>{{ r.error }}</span></div> }
        @if (active()) {
          <div class="callout info" role="status"><nx-icon name="clock" [size]="15" /><span>La corrida está en curso; los resultados se actualizan cada 2 s.</span></div>
        }

        @if (canEdit() && r.status === 'SUCCEEDED') {
          <div class="suggest">
            <div class="field grow"><label for="sug-model">Modelo para sugerir mejoras</label>
              <nx-model-select selectId="sug-model" [providers]="providers()" [(value)]="suggestKey" /></div>
            <button class="btn primary" [disabled]="suggesting() || !suggestKey()" (click)="suggest()">
              <nx-icon name="sparkles" [size]="15" />{{ suggesting() ? 'Analizando…' : 'Sugerir mejoras con IA' }}</button>
          </div>
          <p class="muted small m0">La IA analiza los casos fallidos y propone cambios al perfil y a las instrucciones. Nada se aplica sin su aprobación. Consume tokens del presupuesto.</p>
        }

        <div class="row wrap">
          <strong class="small">Resultados ({{ visible().length }} de {{ r.results.length }})</strong>
          <span class="spacer"></span>
          <label class="checkbox small"><input type="checkbox" [ngModel]="onlyDoubtful()" (ngModelChange)="onlyDoubtful.set($event)" />Solo dudosos o fallidos</label>
        </div>
        <div class="stack">
          @for (res of visible(); track res.id) {
            <nx-eval-result-item [result]="res" [index]="indexOf(res) + 1" [canEdit]="canEdit()" (updated)="onUpdated($event)" />
          } @empty {
            <p class="muted small">{{ r.results.length ? 'No hay casos dudosos ni fallidos. 🎉' : (active() ? 'Aún no hay resultados.' : 'La corrida no tiene resultados.') }}</p>
          }
        </div>
      }
    </section>
  `,
  styles: `
    .m0 { margin: 0; }
    .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; margin: 0; }
    .facts div { padding: 8px 10px; border-radius: 8px; background: var(--surface-2); min-width: 0; }
    dt { font-size: 11px; color: var(--muted); font-weight: 600; }
    dd { margin: 0; font-weight: 650; font-variant-numeric: tabular-nums; }
    .ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .suggest { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
    .grow { flex: 1; min-width: 220px; }
  `,
})
export class TrainingRunDetailComponent {
  private readonly training = inject(TrainingApi);
  private readonly toast = inject(ToastService);
  readonly runId = input.required<string>();
  readonly canEdit = input(false);
  readonly providers = input<ProviderInfo[]>([]);
  readonly closed = output<void>();
  readonly finished = output<void>();
  readonly suggestionCreated = output<void>();

  readonly run = signal<EvalRunDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly onlyDoubtful = signal(false);
  readonly suggesting = signal(false);
  readonly suggestKey = signal('');
  readonly active = computed(() => ['QUEUED', 'RUNNING'].includes(this.run()?.status ?? ''));
  readonly visible = computed(() => {
    const results = this.run()?.results ?? [];
    return this.onlyDoubtful() ? results.filter((r) => r.needsReview || !r.passed) : results;
  });
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    effect(() => {
      this.runId();
      untracked(() => {
        this.run.set(null);
        void this.load();
      });
    });
    effect(() => {
      const p = this.providers();
      if (!untracked(this.suggestKey)) this.suggestKey.set(defaultModelKey(p));
    });
  }

  async load() {
    clearTimeout(this.timer);
    const id = this.runId();
    this.loading.set(true);
    this.error.set(null);
    const wasActive = this.active();
    try {
      const run = await this.training.evalRun(id);
      if (id !== this.runId()) return;
      this.run.set({ ...run, results: run.results ?? [] });
      if (wasActive && !this.active()) this.finished.emit();
      if (this.active()) this.timer = setTimeout(() => void this.load(), POLL_MS);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  indexOf(res: EvalResult) {
    return this.run()?.results.indexOf(res) ?? 0;
  }

  onUpdated(res: EvalResult) {
    this.run.update((r) => (r ? { ...r, results: r.results.map((x) => (x.id === res.id ? res : x)) } : r));
    this.finished.emit();
  }

  async suggest() {
    const parsed = parseModelKey(this.suggestKey());
    if (!parsed) return;
    this.suggesting.set(true);
    try {
      await this.training.createSuggestion(this.runId(), { providerId: parsed.providerId, model: parsed.model });
      this.toast.success('Sugerencia generada; revísela en «Mejorar»');
      this.suggestionCreated.emit();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.suggesting.set(false);
    }
  }

  vlabel(v: number | null) {
    return v === null ? 'Sin versión' : versionLabel(v);
  }

  fmt(v: string | null) {
    return formatDateTime(v);
  }
}
