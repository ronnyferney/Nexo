import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.service';
import { CopilotApi } from '../../core/copilot.api';
import type { CopilotRating } from '../../core/copilot.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

let seq = 0;

/**
 * Calificación de una respuesta del Copilot (ADR 0006 D6). Compartir la conversación con Nexo es opcional y
 * está desmarcado por defecto: sin esa casilla solo viaja la calificación y el comentario.
 */
@Component({
  selector: 'nx-copilot-feedback',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (sent(); as r) {
      <div class="done small" role="status"><nx-icon [name]="r === 'UP' ? 'thumbsUp' : 'thumbsDown'" [size]="13" />Gracias, nos ayuda a mejorar el Copilot</div>
    } @else {
      <div class="bar" role="group" aria-label="Calificar respuesta del Copilot">
        <button type="button" class="btn ghost icon sm" title="Respuesta útil" aria-label="Respuesta útil" [attr.aria-pressed]="draft() === 'UP'" [disabled]="sending()" (click)="open('UP')">
          <nx-icon name="thumbsUp" [size]="14" /></button>
        <button type="button" class="btn ghost icon sm" title="Respuesta poco útil" aria-label="Respuesta poco útil" [attr.aria-pressed]="draft() === 'DOWN'" [disabled]="sending()" (click)="open('DOWN')">
          <nx-icon name="thumbsDown" [size]="14" /></button>
      </div>
      @if (draft(); as d) {
        <form class="form" (ngSubmit)="send(d)">
          <div class="field"><label [for]="uid + '-c'">Comentario (opcional)</label>
            <input [id]="uid + '-c'" class="input" name="comment" [(ngModel)]="comment" [placeholder]="d === 'UP' ? '¿Qué le sirvió?' : '¿Qué faltó o qué estuvo mal?'" /></div>
          <label class="checkbox small"><input type="checkbox" name="share" [(ngModel)]="share" />
            Compartir esta conversación con Nexo para mejorar el Copilot</label>
          <div class="row"><span class="spacer"></span>
            <button type="button" class="btn sm" (click)="draft.set(null)">Cancelar</button>
            <button type="submit" class="btn sm primary" [disabled]="sending()">{{ sending() ? 'Enviando…' : 'Enviar' }}</button></div>
        </form>
      }
    }
  `,
  styles: `
    :host { display: block; align-self: flex-start; width: 100%; max-width: 92%; margin-top: -6px; }
    .bar { display: flex; gap: 2px; }
    .bar .btn { color: var(--muted); }
    .bar .btn.icon.sm { width: 30px; }
    .bar .btn[aria-pressed='true'] { color: var(--primary); }
    .done { display: inline-flex; gap: 6px; align-items: center; color: var(--success); padding: 4px 6px; }
    .form { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
    .checkbox { align-items: flex-start; }
    .checkbox input { margin-top: 2px; }
  `,
})
export class CopilotFeedbackComponent {
  private readonly api = inject(CopilotApi);
  private readonly toast = inject(ToastService);
  readonly messageId = input.required<string>();

  readonly uid = `cfb-${++seq}`;
  readonly draft = signal<CopilotRating | null>(null);
  readonly sending = signal(false);
  readonly sent = signal<CopilotRating | null>(null);
  comment = '';
  share = false;

  open(r: CopilotRating) {
    this.draft.set(this.draft() === r ? null : r);
  }

  async send(rating: CopilotRating) {
    if (this.sending()) return;
    this.sending.set(true);
    try {
      await this.api.feedback(this.messageId(), { rating, comment: this.comment.trim() || undefined, shareConversation: this.share });
      this.sent.set(rating);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.sending.set(false);
    }
  }
}
