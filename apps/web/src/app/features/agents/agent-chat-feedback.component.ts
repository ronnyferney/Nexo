import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.service';
import { TrainingApi } from '../../core/training.api';
import type { FeedbackRating } from '../../core/training.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

let seq = 0;

/**
 * Calificación de una respuesta del chat (ADR 0004 D1): 👍 se envía al instante; 👎 pide un comentario opcional;
 * «Corregir» permite editar la respuesta. Todo 👎 o corrección llega a la bandeja de supervisión.
 */
@Component({
  selector: 'nx-agent-chat-feedback',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (sent(); as r) {
      <div class="fb-done small" role="status">
        <nx-icon [name]="r === 'UP' ? 'thumbsUp' : 'thumbsDown'" [size]="13" />
        {{ r === 'UP' ? 'Gracias por su calificación' : (corrected() ? 'Corrección enviada a supervisión' : 'Enviado a supervisión') }}
      </div>
    } @else {
      <div class="fb-bar" role="group" aria-label="Calificar respuesta">
        <button type="button" class="btn ghost icon sm" title="Buena respuesta" aria-label="Buena respuesta" [disabled]="sending()" (click)="rate('UP')">
          <nx-icon name="thumbsUp" [size]="14" /></button>
        <button type="button" class="btn ghost icon sm" title="Mala respuesta" aria-label="Mala respuesta" [attr.aria-pressed]="mode() === 'down'"
          [attr.aria-expanded]="mode() === 'down'" [disabled]="sending()" (click)="open('down')"><nx-icon name="thumbsDown" [size]="14" /></button>
        <button type="button" class="btn ghost sm" [attr.aria-expanded]="mode() === 'correct'" [disabled]="sending()" (click)="open('correct')">
          <nx-icon name="pencil" [size]="13" />Corregir</button>
      </div>
      @if (mode() !== 'idle') {
        <form class="fb-form" (ngSubmit)="submit()">
          @if (mode() === 'correct') {
            <div class="field"><label [for]="uid + '-c'">Respuesta corregida</label>
              <textarea [id]="uid + '-c'" class="input" rows="5" name="correction" [(ngModel)]="correction"></textarea></div>
          }
          <div class="field"><label [for]="uid + '-m'">Comentario (opcional)</label>
            <input [id]="uid + '-m'" class="input" name="comment" [(ngModel)]="comment" placeholder="¿Qué estuvo mal o qué faltó?" /></div>
          <div class="row"><span class="spacer"></span>
            <button type="button" class="btn sm" (click)="mode.set('idle')">Cancelar</button>
            <button type="submit" class="btn sm primary" [disabled]="sending() || (mode() === 'correct' && !correctionChanged())">
              {{ sending() ? 'Enviando…' : 'Enviar' }}</button>
          </div>
        </form>
      }
    }
  `,
  styles: `
    :host { display: block; align-self: flex-start; max-width: 88%; width: 100%; margin-top: -8px; }
    .fb-bar { display: flex; align-items: center; gap: 2px; color: var(--muted); }
    .fb-bar .btn { color: var(--muted); }
    .fb-bar .btn.icon.sm { width: 30px; }
    .fb-done { display: inline-flex; align-items: center; gap: 6px; color: var(--success); padding: 4px 6px; }
    .fb-form { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
  `,
})
export class AgentChatFeedbackComponent {
  private readonly training = inject(TrainingApi);
  private readonly toast = inject(ToastService);
  readonly agentId = input.required<string>();
  readonly conversationId = input<string | undefined>(undefined);
  readonly userMessage = input.required<string>();
  readonly agentResponse = input.required<string>();

  readonly uid = `fb-${++seq}`;
  readonly mode = signal<'idle' | 'down' | 'correct'>('idle');
  readonly sending = signal(false);
  readonly sent = signal<FeedbackRating | null>(null);
  readonly corrected = signal(false);
  comment = '';
  correction = '';

  open(mode: 'down' | 'correct') {
    if (this.mode() === mode) return this.mode.set('idle');
    if (mode === 'correct' && !this.correction) this.correction = this.agentResponse();
    this.mode.set(mode);
  }

  correctionChanged() {
    const c = this.correction.trim();
    return !!c && c !== this.agentResponse().trim();
  }

  rate(rating: FeedbackRating) {
    void this.send(rating);
  }

  submit() {
    void this.send('DOWN');
  }

  private async send(rating: FeedbackRating) {
    if (this.sending()) return;
    const withCorrection = rating === 'DOWN' && this.mode() === 'correct' && this.correctionChanged();
    this.sending.set(true);
    try {
      await this.training.sendFeedback(this.agentId(), {
        conversationId: this.conversationId() || undefined,
        userMessage: this.userMessage(),
        agentResponse: this.agentResponse(),
        rating,
        comment: rating === 'DOWN' ? this.comment.trim() || undefined : undefined,
        correction: withCorrection ? this.correction.trim() : undefined,
      });
      this.corrected.set(withCorrection);
      this.sent.set(rating);
      this.mode.set('idle');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.sending.set(false);
    }
  }
}
