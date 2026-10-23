import { ChangeDetectionStrategy, Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../../core/api.service';
import { TrainingApi } from '../../../core/training.api';
import type { Feedback, FeedbackReviewAction } from '../../../core/training.models';
import { ToastService } from '../../../core/toast.service';
import { IconComponent } from '../../../shared/icon.component';
import { RelativeTimePipe } from '../../../shared/relative-time.pipe';
import { formatDateTime, httpStatus } from './training-utils';

const STATUS: Record<Feedback['status'], { cls: string; label: string }> = {
  PENDING: { cls: 'warning', label: 'Pendiente' },
  APPROVED: { cls: 'success', label: 'Aprobado' },
  DISCARDED: { cls: '', label: 'Descartado' },
};

/** Tarjeta de revisión de una calificación del chat: aprobar (con corrección y caso de evaluación) o descartar. */
@Component({
  selector: 'nx-feedback-review-item',
  imports: [FormsModule, RouterLink, IconComponent, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let fb = feedback();
    <article class="card fb" [attr.aria-label]="'Retroalimentación sobre ' + fb.agentName">
      <header class="row wrap">
        <span class="badge" [class.success]="fb.rating === 'UP'" [class.danger]="fb.rating === 'DOWN'">
          <nx-icon [name]="fb.rating === 'UP' ? 'thumbsUp' : 'thumbsDown'" [size]="13" />{{ fb.rating === 'UP' ? 'Positiva' : 'Negativa' }}</span>
        @if (fb.correction) { <span class="badge info"><nx-icon name="pencil" [size]="12" />Con corrección</span> }
        <span class="badge {{ status(fb).cls }}">{{ status(fb).label }}</span>
        @if (showAgent()) {
          <a class="small agent" [routerLink]="['/agents', fb.agentId]" [queryParams]="{ tab: 'training' }"><nx-icon name="bot" [size]="13" /> {{ fb.agentName }}</a>
        }
        <span class="spacer"></span>
        <span class="muted small" [title]="fmt(fb.createdAt)">Recibido {{ fb.createdAt | ago }}</span>
      </header>

      <div class="io">
        <div><span class="tag">Mensaje del usuario</span><p>{{ fb.userMessage }}</p></div>
        <div><span class="tag out">Respuesta del agente</span><p>{{ fb.agentResponse }}</p></div>
      </div>
      @if (fb.comment) { <div class="callout"><nx-icon name="info" [size]="15" /><span><strong>Comentario:</strong> {{ fb.comment }}</span></div> }

      @if (fb.status === 'PENDING') {
        @if (canEdit()) {
          <div class="field"><label [for]="'fbc-' + fb.id">Respuesta corregida <span class="muted">(opcional; al aprobar se crea un ejemplo de entrenamiento)</span></label>
            <textarea [id]="'fbc-' + fb.id" class="input" rows="4" [(ngModel)]="correction" placeholder="Escriba cómo debió responder el agente…"></textarea></div>
          @if (fullError()) {
            <div class="callout danger" role="alert"><nx-icon name="alert" [size]="15" /><span>{{ fullError() }}</span></div>
          }
          <div class="row wrap actions">
            <label class="checkbox small"><input type="checkbox" [(ngModel)]="addAsEvalCase" />Agregar también como caso de evaluación</label>
            <span class="spacer"></span>
            <button class="btn sm" [disabled]="busy()" (click)="review('DISCARD')"><nx-icon name="x" [size]="14" />Descartar</button>
            <button class="btn sm primary" [disabled]="busy()" (click)="review('APPROVE')"><nx-icon name="check" [size]="14" />{{ busy() ? 'Guardando…' : 'Aprobar' }}</button>
          </div>
        } @else {
          @if (fb.correction) { <div><span class="tag fix">Corrección propuesta</span><p class="pre">{{ fb.correction }}</p></div> }
          <p class="muted small m0">Solo los editores pueden revisar la retroalimentación.</p>
        }
      } @else {
        @if (fb.correction) { <div><span class="tag fix">Corrección</span><p class="pre">{{ fb.correction }}</p></div> }
        @if (fb.reviewedAt) { <p class="muted small m0">Revisado {{ fb.reviewedAt | ago }}</p> }
      }
    </article>
  `,
  styles: `
    .fb { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
    .agent { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; }
    .io { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .io > div { min-width: 0; padding: 10px 12px; border-radius: 10px; background: var(--surface-2); }
    p { margin: 4px 0 0; white-space: pre-wrap; word-break: break-word; font-size: 13px; }
    .pre { padding: 8px 10px; border: 1px dashed var(--border); border-radius: 8px; }
    .tag { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--info); }
    .tag.out { color: var(--primary); }
    .tag.fix { color: var(--success); }
    .m0 { margin: 0; }
    .actions { row-gap: 8px; }
    @media (max-width: 640px) { .io { grid-template-columns: 1fr; } }
  `,
})
export class FeedbackReviewItemComponent implements OnInit {
  private readonly training = inject(TrainingApi);
  private readonly toast = inject(ToastService);
  readonly feedback = input.required<Feedback>();
  readonly canEdit = input(false);
  readonly showAgent = input(false);
  readonly reviewed = output<{ feedback: Feedback; action: FeedbackReviewAction }>();

  readonly busy = signal(false);
  readonly fullError = signal<string | null>(null);
  correction = '';
  addAsEvalCase = false;

  ngOnInit() {
    this.correction = this.feedback().correction ?? '';
  }

  status(fb: Feedback) {
    return STATUS[fb.status] ?? { cls: '', label: fb.status };
  }

  fmt(v: string) {
    return formatDateTime(v);
  }

  async review(action: FeedbackReviewAction) {
    const fb = this.feedback();
    if (action === 'DISCARD' && !confirm('¿Descartar esta retroalimentación?')) return;
    this.busy.set(true);
    this.fullError.set(null);
    try {
      const correction = this.correction.trim();
      const updated = await this.training.reviewFeedback(
        fb.id,
        action === 'APPROVE'
          ? { action, correction: correction || undefined, addAsEvalCase: this.addAsEvalCase }
          : { action },
      );
      this.toast.success(action === 'APPROVE' ? 'Retroalimentación aprobada' : 'Retroalimentación descartada');
      const fallback: Feedback = {
        ...fb,
        status: action === 'APPROVE' ? 'APPROVED' : 'DISCARDED',
        correction: correction || fb.correction,
        reviewedAt: new Date().toISOString(),
      };
      this.reviewed.emit({ feedback: updated && typeof updated === 'object' && 'status' in updated ? updated : fallback, action });
    } catch (e) {
      if (httpStatus(e) === 409) {
        this.fullError.set(
          `${errorMessage(e)} — El agente alcanzó el máximo de ejemplos de entrenamiento. Elimine alguno en la pestaña «Conocimiento» o apruebe sin corrección.`,
        );
      } else this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
