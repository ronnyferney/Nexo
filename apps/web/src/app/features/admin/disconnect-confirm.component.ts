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
import type { ConnectionUsage } from '../../core/llm-providers.models';

/** `signOut` conserva la conexión (solo borra los tokens); `delete` y `disconnect` la eliminan con sus modelos. */
export type DisconnectAction = 'signOut' | 'delete' | 'disconnect';

/**
 * Confirmación «¿Cerrar sesión de <Proveedor>?» / «¿Eliminar la conexión…?» / «¿Desconectar <Proveedor>?». Se apila sobre el diálogo del proveedor;
 * el foco inicial queda en «Cancelar» (acción segura) y Escape cancela.
 */
@Component({
  selector: 'nx-disconnect-confirm',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="modal confirm" role="alertdialog" aria-labelledby="dc-title" aria-describedby="dc-desc"
      (cancel)="onCancel($event)" (close)="cancelled.emit()">
      <div class="modal-body">
        <h2 id="dc-title">{{ copy().title }}</h2>
        <p id="dc-desc">{{ copy().text }}</p>
        @if (agents().length) {
          <div class="callout" [class.warning]="!blocked()" [class.danger]="blocked()" role="note">
            <span>
              @if (blocked()) { No se puede eliminar: la usan {{ agents().length }} {{ agents().length === 1 ? 'agente' : 'agentes' }} }
              @else { La usan {{ agents().length }} {{ agents().length === 1 ? 'agente' : 'agentes' }} }
              ({{ agentList() }}).
              {{ blocked() ? 'Asígneles otro modelo primero.' : 'Usarán su modelo de respaldo si lo tienen.' }}
            </span>
          </div>
        }
        <div class="foot">
          <button type="button" class="btn pill cancel" [disabled]="busy()" (click)="cancelled.emit()">Cancelar</button>
          <button type="button" class="btn pill solid-danger" [disabled]="busy() || blocked()" (click)="confirmed.emit()">
            {{ busy() ? copy().busy : copy().action }}</button>
        </div>
      </div>
    </dialog>
  `,
  styles: `
    dialog.confirm { width: min(440px, calc(100vw - 24px)); border-radius: 16px; }
    .modal-body { padding: 22px 22px 18px; }
    h2 { font-size: 18px; overflow-wrap: anywhere; }
    p { margin: 0; color: var(--muted); line-height: 1.55; }
    .callout { margin-top: 12px; }
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
  readonly action = input<DisconnectAction>('disconnect');

  readonly copy = computed(() => {
    const n = this.name();
    switch (this.action()) {
      case 'signOut':
        return {
          title: `¿Cerrar sesión de ${n}?`,
          text: `${n} no se usará hasta que vuelva a iniciar sesión; las tareas que lo usen fallarán mientras tanto. Se conservan la conexión, sus modelos y los agentes asignados.`,
          action: 'Cerrar sesión',
          busy: 'Cerrando sesión…',
        };
      case 'delete':
        return {
          title: `¿Eliminar la conexión ${n}?`,
          text: `Se cierra la sesión y se eliminan la conexión y sus modelos. Para volver a usarlo deberá conectarlo de nuevo.`,
          action: 'Eliminar conexión',
          busy: 'Eliminando…',
        };
      default:
        return {
          title: `¿Desconectar ${n}?`,
          text: `${n} no se usará hasta que lo vuelva a conectar. Las tareas existentes pueden fallar. Se eliminan la conexión y sus modelos.`,
          action: 'Desconectar',
          busy: 'Desconectando…',
        };
    }
  });
  readonly busy = input(false);
  /** Agentes que usan la conexión: bloquean eliminarla y avisan al cerrar sesión. */
  readonly usage = input<ConnectionUsage[] | null>(null);

  readonly agents = computed(() => [...new Set((this.usage() ?? []).map((u) => u.agentName))]);
  readonly agentList = computed(() => {
    const a = this.agents();
    return a.slice(0, 4).join(', ') + (a.length > 4 ? ` y ${a.length - 4} más` : '');
  });
  /** Eliminar o desconectar una conexión en uso lo rechaza el servidor (409): se explica antes de intentarlo. */
  readonly blocked = computed(() => this.action() !== 'signOut' && this.agents().length > 0);
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
