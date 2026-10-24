import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';
import type { ConnectorUsage } from '../../core/integrations.models';

/** `disconnect` borra los tokens y conserva el conector; `remove` elimina el conector con sus operaciones. */
export type AccountAction = 'disconnect' | 'remove';

/**
 * Confirmación al desconectar o eliminar la cuenta de una app: dice qué agentes y flujos dejan de funcionar.
 * El foco inicial queda en «Cancelar» (acción segura) y Escape cancela.
 */
@Component({
  selector: 'nx-account-confirm',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="modal confirm" role="alertdialog" aria-labelledby="ac-title" aria-describedby="ac-desc"
      (cancel)="$event.preventDefault(); cancelled.emit()">
      <div class="modal-body">
        <h2 id="ac-title">{{ action() === 'remove' ? '¿Eliminar ' + name() + '?' : '¿Desconectar ' + name() + '?' }}</h2>
        <p id="ac-desc">
          {{ action() === 'remove'
            ? 'Se elimina la cuenta con sus operaciones. Para volver a usarla deberá instalarla de nuevo.'
            : 'Se borran los permisos guardados. Puede volver a conectarla cuando quiera.' }}</p>
        @if (usage(); as u) {
          @if (u.agents.length || u.workflows.length) {
            <div class="callout warning" role="note"><span>
              Dejarán de funcionar:
              @if (u.agents.length) { <strong>{{ u.agents.length }} {{ u.agents.length === 1 ? 'agente' : 'agentes' }}</strong> ({{ list(u.agents) }}) }
              @if (u.agents.length && u.workflows.length) { y }
              @if (u.workflows.length) { <strong>{{ u.workflows.length }} {{ u.workflows.length === 1 ? 'flujo' : 'flujos' }}</strong> ({{ list(u.workflows) }}) }.
            </span></div>
          } @else {
            <p class="small ok">Ningún agente ni flujo la usa.</p>
          }
        } @else {
          <p class="small muted">Revisando qué la usa…</p>
        }
        <div class="foot">
          <button type="button" class="btn pill cancel" [disabled]="busy()" (click)="cancelled.emit()">Cancelar</button>
          <button type="button" class="btn pill solid-danger" [disabled]="busy() || !usage()" (click)="confirmed.emit()">
            {{ busy() ? 'Procesando…' : actionLabel() }}</button>
        </div>
      </div>
    </dialog>
  `,
  styles: `
    dialog.confirm { width: min(440px, calc(100vw - 24px)); border-radius: 16px; }
    .modal-body { padding: 22px 22px 18px; }
    h2 { font-size: 18px; overflow-wrap: anywhere; }
    p { margin: 0; color: var(--muted); line-height: 1.55; }
    .ok { margin-top: 10px; color: var(--success); }
    .callout { margin-top: 12px; }
    .foot { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; padding-top: 6px; }
    .pill { border-radius: 999px; height: 38px; padding: 0 18px; }
    .solid-danger { background: #c62f48; border-color: #c62f48; color: #fff; }
    .solid-danger:hover:not(:disabled) { background: #b0122d; border-color: #b0122d; color: #fff; }
    @media (max-width: 420px) { .foot .btn { flex: 1 1 auto; justify-content: center; } }
  `,
})
export class AccountConfirmComponent {
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  readonly name = input.required<string>();
  readonly action = input<AccountAction>('disconnect');
  /** null mientras se consulta (el botón de confirmar espera a saber el impacto). */
  readonly usage = input<ConnectorUsage | null>(null);
  readonly busy = input(false);
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  readonly actionLabel = computed(() => (this.action() === 'remove' ? 'Eliminar' : 'Desconectar'));

  constructor() {
    afterNextRender(() => {
      const dlg = this.dialog().nativeElement;
      dlg.showModal();
      dlg.querySelector<HTMLButtonElement>('.cancel')?.focus();
    });
  }

  list(items: { name: string }[]): string {
    const names = items.slice(0, 3).map((i) => i.name);
    return items.length > 3 ? `${names.join(', ')} y ${items.length - 3} más` : names.join(', ');
  }
}
