import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, input, output, viewChild } from '@angular/core';

/**
 * Confirmación «¿Cerrar sesión de <Proveedor>?» / «¿Desconectar <Proveedor>?». Se apila sobre el diálogo del proveedor;
 * el foco inicial queda en «Cancelar» (acción segura) y Escape cancela.
 */
@Component({
  selector: 'nx-disconnect-confirm',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="modal confirm" role="alertdialog" aria-labelledby="dc-title" aria-describedby="dc-desc"
      (cancel)="onCancel($event)" (close)="cancelled.emit()">
      <div class="modal-body">
        <h2 id="dc-title">{{ signedIn() ? '¿Cerrar sesión de ' + name() + '?' : '¿Desconectar ' + name() + '?' }}</h2>
        <p id="dc-desc">
          {{ name() }} no se usará hasta que {{ signedIn() ? 'vuelva a iniciar sesión' : 'lo vuelva a conectar' }}.
          Las tareas existentes pueden fallar. @if (!signedIn()) { Se eliminan la conexión y sus modelos. }
        </p>
        <div class="foot">
          <button type="button" class="btn pill cancel" [disabled]="busy()" (click)="cancelled.emit()">Cancelar</button>
          <button type="button" class="btn pill solid-danger" [disabled]="busy()" (click)="confirmed.emit()">
            {{ busy() ? (signedIn() ? 'Cerrando sesión…' : 'Desconectando…') : signedIn() ? 'Cerrar sesión' : 'Desconectar' }}</button>
        </div>
      </div>
    </dialog>
  `,
  styles: `
    dialog.confirm { width: min(440px, calc(100vw - 24px)); border-radius: 16px; }
    .modal-body { padding: 22px 22px 18px; }
    h2 { font-size: 18px; overflow-wrap: anywhere; }
    p { margin: 0; color: var(--muted); line-height: 1.55; }
    .foot { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; padding-top: 6px; }
    .pill { border-radius: 999px; height: 38px; padding: 0 18px; }
    .solid-danger { background: #c62f48; border-color: #c62f48; color: #fff; }
    .solid-danger:hover:not(:disabled) { background: #b0122d; border-color: #b0122d; color: #fff; }
    .btn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    @media (max-width: 420px) { .foot .btn { flex: 1 1 auto; justify-content: center; } }
  `,
})
export class DisconnectConfirmComponent {
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  readonly name = input.required<string>();
  readonly signedIn = input(false);
  readonly busy = input(false);
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  /** Escape cierra (y emite `cancelled` en `close`), salvo mientras se desconecta. */
  onCancel(ev: Event) {
    if (this.busy()) ev.preventDefault();
  }

  constructor() {
    afterNextRender(() => {
      const dlg = this.dialog().nativeElement;
      dlg.showModal();
      dlg.querySelector<HTMLElement>('.cancel')?.focus();
    });
  }
}
