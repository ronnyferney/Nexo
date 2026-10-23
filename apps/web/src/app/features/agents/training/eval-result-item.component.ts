import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/api.service';
import { TrainingApi } from '../../../core/training.api';
import type { EvalResult } from '../../../core/training.models';
import { ToastService } from '../../../core/toast.service';
import { IconComponent } from '../../../shared/icon.component';
import { ScorePipe } from '../../../shared/score.pipe';

/** Resultado de un caso en una corrida: salida, calificación del juez y revisión humana (`PATCH /eval-results/:id`). */
@Component({
  selector: 'nx-eval-result-item',
  imports: [FormsModule, IconComponent, ScorePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let r = result();
    <article class="res" [class.fail]="!r.passed" [attr.aria-label]="'Caso ' + index()">
      <header class="row wrap">
        <strong class="small">Caso {{ index() }}</strong>
        <span class="badge" [class.success]="r.passed" [class.danger]="!r.passed">{{ r.passed ? 'Aprobado' : 'Fallido' }}</span>
        @if (r.needsReview && r.humanScore === null) { <span class="badge warning"><nx-icon name="flag" [size]="12" />Requiere revisión</span> }
        @if (r.humanScore !== null) { <span class="badge info"><nx-icon name="user" [size]="12" />Revisado</span> }
        <span class="spacer"></span>
        <span class="small muted">Juez <strong class="sc">{{ r.score | score }}</strong></span>
        @if (r.humanScore !== null) { <span class="small muted">· Humano <strong class="sc">{{ r.humanScore | score }}</strong></span> }
        <span class="small">· Efectivo <strong class="sc">{{ effective() | score }}</strong></span>
      </header>
      <div class="cols">
        <div><span class="tag">Entrada</span><p>{{ r.input }}</p></div>
        <div><span class="tag exp">Esperado</span><p>{{ r.expected || '— (solo criterios)' }}</p></div>
        <div><span class="tag out">Salida del agente</span><p>{{ r.output || '— sin salida' }}</p></div>
      </div>
      @if (r.reasoning) { <div class="reason small"><nx-icon name="sparkles" [size]="14" /><span><strong>Razonamiento del juez:</strong> {{ r.reasoning }}</span></div> }
      @if (r.humanNote) { <div class="reason small"><nx-icon name="user" [size]="14" /><span><strong>Nota del revisor:</strong> {{ r.humanNote }}</span></div> }

      @if (canEdit()) {
        @if (editing()) {
          <form class="review" (ngSubmit)="save()">
            <div class="field score-f"><label [for]="'hs-' + r.id">Puntaje humano (0–1)</label>
              <input [id]="'hs-' + r.id" class="input" type="number" name="score" min="0" max="1" step="0.05" required [(ngModel)]="draftScore"
                [class.invalid]="!validScore()" [attr.aria-invalid]="!validScore()" /></div>
            <div class="field grow"><label [for]="'hn-' + r.id">Nota (opcional)</label>
              <input [id]="'hn-' + r.id" class="input" name="note" [(ngModel)]="draftNote" placeholder="Por qué cambia el puntaje" /></div>
            <div class="row btns">
              <button type="button" class="btn sm" (click)="editing.set(false)">Cancelar</button>
              <button type="submit" class="btn sm primary" [disabled]="saving() || !validScore()">{{ saving() ? 'Guardando…' : 'Guardar' }}</button>
            </div>
          </form>
        } @else {
          <div class="row"><span class="spacer"></span>
            <button class="btn sm" (click)="startEdit()"><nx-icon name="pencil" [size]="13" />{{ r.humanScore === null ? 'Fijar puntaje humano' : 'Cambiar puntaje humano' }}</button></div>
        }
      }
    </article>
  `,
  styles: `
    .res { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--border); border-left: 3px solid var(--success); border-radius: 10px; }
    .res.fail { border-left-color: var(--danger); }
    .sc { color: var(--text); font-variant-numeric: tabular-nums; }
    .cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .cols > div { min-width: 0; }
    p { margin: 4px 0 0; white-space: pre-wrap; word-break: break-word; font-size: 13px; max-height: 220px; overflow: auto; }
    .tag { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--info); }
    .tag.exp { color: var(--success); }
    .tag.out { color: var(--primary); }
    .reason { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-radius: 8px; background: var(--surface-2); }
    .review { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; padding-top: 8px; border-top: 1px dashed var(--border); }
    .score-f { width: 150px; }
    .grow { flex: 1; min-width: 180px; }
    .btns { gap: 8px; }
    @media (max-width: 900px) { .cols { grid-template-columns: 1fr; } }
  `,
})
export class EvalResultItemComponent implements OnInit {
  private readonly training = inject(TrainingApi);
  private readonly toast = inject(ToastService);
  readonly result = input.required<EvalResult>();
  readonly index = input(1);
  readonly canEdit = input(false);
  readonly updated = output<EvalResult>();

  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly effective = computed(() => {
    const r = this.result();
    return r.effectiveScore ?? r.humanScore ?? r.score;
  });
  draftScore: number | null = null;
  draftNote = '';

  ngOnInit() {
    this.reset();
  }

  private reset() {
    const r = this.result();
    this.draftScore = r.humanScore ?? r.score ?? null;
    this.draftNote = r.humanNote ?? '';
  }

  startEdit() {
    this.reset();
    this.editing.set(true);
  }

  validScore() {
    const v = this.draftScore;
    return typeof v === 'number' && !Number.isNaN(v) && v >= 0 && v <= 1;
  }

  async save() {
    if (!this.validScore()) return;
    this.saving.set(true);
    try {
      const humanScore = Math.round(this.draftScore! * 100) / 100;
      const humanNote = this.draftNote.trim() || undefined;
      const saved = await this.training.reviewEvalResult(this.result().id, { humanScore, humanNote });
      const local: EvalResult = { ...this.result(), humanScore, humanNote: humanNote ?? null, effectiveScore: humanScore };
      this.updated.emit(saved && typeof saved === 'object' ? { ...local, ...saved } : local);
      this.editing.set(false);
      this.toast.success('Puntaje humano guardado');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
