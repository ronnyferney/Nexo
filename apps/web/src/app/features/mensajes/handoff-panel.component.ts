import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.service';
import { MessagingApi } from '../../core/messaging.api';
import { ToastService } from '../../core/toast.service';
import type { ContratoTransferencia } from '../../core/messaging.models';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import {
  corto,
  estadoTransferenciaMeta,
  ordenarSegmentos,
  puedeDecidirTransferencia,
} from './mensajes.util';

type Formulario = 'none' | 'proponer' | 'rechazar';

/**
 * Cadena de handoff de una tarea (RF09/RF33), embebida en el detalle de la tarea (E4). Muestra los SEGMENTOS como una
 * cadena «quién encargó → quién aceptó → quién entregó», el estado alcanzado y el criterio del siguiente paso, y
 * concentra las acciones proponer/aceptar/rechazar. Al aceptar, el backend continúa desde el estado persistido (sin
 * rehacer); al rechazar se exige motivo. Las mutaciones solo se ofrecen con permiso de edición (el servidor decide).
 */
@Component({
  selector: 'nx-handoff-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, FormsModule, IconComponent, EmptyStateComponent, LoadingStateComponent, RelativeTimePipe],
  template: `
    <section class="card handoff">
      <header class="card-title">
        <nx-icon name="shuffle" [size]="18" />
        <h2>Continuidad / Handoff</h2>
        @if (segmentos().length) {
          <span class="badge">{{ segmentos().length }} segmento(s)</span>
        }
      </header>

      @if (loading()) {
        <nx-loading-state text="Cargando la cadena de handoff…" size="sm" />
      } @else if (error()) {
        <p class="error-text" role="alert">{{ error() }}</p>
        <button class="btn sm" (click)="cargar()"><nx-icon name="refresh" [size]="14" />Reintentar</button>
      } @else if (segmentos().length) {
        <ol class="cadena">
          @for (t of segmentos(); track t.id) {
            <li>
              <div class="eslabon">
                <span class="paso">#{{ t.secuenciaSegmento }}</span>
                <span class="actor" title="Quién encargó / salió">
                  <nx-icon name="bot" [size]="14" />{{ t.fromAgentId ? corto(t.fromAgentId) : 'Origen' }}
                </span>
                <nx-icon class="flecha" name="arrowLeft" [size]="14" />
                <span class="actor" title="Responsable entrante">
                  @if (t.toAgentId) {
                    <nx-icon name="bot" [size]="14" />{{ corto(t.toAgentId) }}
                  } @else if (t.toEquipoId) {
                    <nx-icon name="users" [size]="14" />Equipo {{ corto(t.toEquipoId) }}
                  } @else {
                    <nx-icon name="user" [size]="14" />Sin asignar
                  }
                </span>
                <span class="badge {{ meta(t.estado).badge }}">{{ meta(t.estado).label }}</span>
              </div>
              @if (t.criterioSiguiente) {
                <p class="criterio"><strong>Siguiente:</strong> {{ t.criterioSiguiente }}</p>
              }
              @if (t.responsableEntranteUserId) {
                <p class="sub">Responsable humano entrante: {{ corto(t.responsableEntranteUserId) }}</p>
              }
              @if (t.estado === 'RECHAZADO' && t.motivoRechazo) {
                <p class="sub motivo"><nx-icon name="x" [size]="13" />Rechazado: {{ t.motivoRechazo }}</p>
              }
              <p class="sub tiempo">
                <nx-icon name="clock" [size]="12" />{{ (t.decididoAt ?? t.createdAt) | ago }}
                · {{ (t.decididoAt ?? t.createdAt) | date: 'short' }}
              </p>

              @if (canEdit() && decidible(t)) {
                <div class="acciones">
                  <button class="btn sm primary" [disabled]="busy()" (click)="aceptar(t)" title="Aceptar y continuar desde el estado persistido">
                    <nx-icon name="check" [size]="14" />Aceptar
                  </button>
                  <button class="btn sm" [disabled]="busy()" (click)="abrirRechazo(t)" title="Rechazar con motivo">
                    <nx-icon name="x" [size]="14" />Rechazar
                  </button>
                </div>
              }

              @if (form() === 'rechazar' && objetivo()?.id === t.id) {
                <form class="mini" (ngSubmit)="rechazar(t)">
                  <div class="field">
                    <label for="motivo-{{ t.id }}">Motivo del rechazo (auditable)</label>
                    <input id="motivo-{{ t.id }}" class="input" [(ngModel)]="rMotivo" name="motivo" required />
                  </div>
                  <div class="acciones">
                    <button type="submit" class="btn sm primary" [disabled]="busy() || !rMotivo().trim()">Rechazar</button>
                    <button type="button" class="btn sm ghost" (click)="cerrar()">Cancelar</button>
                  </div>
                </form>
              }
            </li>
          }
        </ol>
      } @else {
        <nx-empty-state
          icon="shuffle"
          title="Sin transferencias"
          description="Esta tarea no se ha transferido. Un handoff lleva la tarea a un punto de corte y otro agente continúa desde el estado persistido, sin rehacer." />
      }

      @if (canEdit()) {
        @if (form() !== 'proponer') {
          <div class="pie-acciones">
            <button class="btn" [disabled]="busy()" (click)="abrirPropuesta()">
              <nx-icon name="plus" [size]="15" />Proponer handoff
            </button>
          </div>
        } @else {
          <form class="mini" (ngSubmit)="proponer()">
            <div class="row">
              <div class="field">
                <label for="from">Agente saliente (opcional)</label>
                <input id="from" class="input" [(ngModel)]="pFrom" name="from" placeholder="ID del agente" />
              </div>
              <div class="field">
                <label for="to">Agente entrante (opcional)</label>
                <input id="to" class="input" [(ngModel)]="pTo" name="to" placeholder="ID del agente" />
              </div>
            </div>
            <div class="field">
              <label for="crit">Criterio del siguiente paso</label>
              <textarea id="crit" class="input" rows="2" [(ngModel)]="pCriterio" name="crit"></textarea>
            </div>
            <div class="field">
              <label for="estado">Estado alcanzado (resumen del punto de corte)</label>
              <textarea id="estado" class="input" rows="2" [(ngModel)]="pEstado" name="estado"
                placeholder="Qué quedó hecho y confirmado hasta aquí"></textarea>
            </div>
            <div class="row">
              <div class="field">
                <label for="resp">Responsable humano entrante (opcional)</label>
                <input id="resp" class="input" [(ngModel)]="pResponsable" name="resp" placeholder="ID de usuario" />
              </div>
              <div class="field">
                <label for="wf">Flujo del segmento entrante (opcional)</label>
                <input id="wf" class="input" [(ngModel)]="pWorkflow" name="wf" placeholder="ID de flujo" />
              </div>
            </div>
            <p class="hint" role="note">
              Un handoff no amplía atribuciones: el tramo entrante recibe solo los permisos vigentes del receptor.
            </p>
            <div class="acciones">
              <button type="submit" class="btn primary" [disabled]="busy()">Proponer</button>
              <button type="button" class="btn ghost" (click)="cerrar()">Cancelar</button>
            </div>
          </form>
        }
      }
    </section>
  `,
  styles: `
    .handoff { display: flex; flex-direction: column; gap: 14px; }
    .card-title { flex-wrap: wrap; }
    .card-title h2 { font-size: 16px; margin: 0; flex: 1; }
    .cadena { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
    .cadena li { border-left: 2px solid var(--border); padding-left: 12px; display: flex; flex-direction: column; gap: 5px; }
    .eslabon { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .paso { font-weight: 700; font-size: 13px; color: var(--muted); }
    .actor { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 600; }
    .flecha { transform: rotate(180deg); color: var(--muted); }
    .criterio { margin: 0; font-size: 13px; }
    .sub { margin: 0; font-size: 12px; color: var(--muted); display: inline-flex; align-items: center; gap: 5px; }
    .sub.motivo { color: var(--danger); }
    .acciones { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
    .pie-acciones { display: flex; }
    .mini { display: flex; flex-direction: column; gap: 10px; background: var(--surface-2); padding: 14px; border-radius: 10px; }
    .mini .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .hint { margin: 0; font-size: 12px; color: var(--muted); }
    @media (max-width: 560px) { .mini .row { grid-template-columns: 1fr; } }
  `,
})
export class HandoffPanelComponent {
  private readonly api = inject(MessagingApi);
  private readonly toast = inject(ToastService);

  readonly tareaId = input.required<string>();
  readonly canEdit = input(false);
  /** ID del agente ejecutor actual, para prellenar el «saliente» de una propuesta. */
  readonly ejecutorAgentId = input<string | null>(null);
  /** Se emite cuando una transferencia se acepta/rechaza/propone (el responsable de la tarea puede cambiar). */
  readonly changed = output<void>();

  protected readonly corto = corto;
  protected readonly transferencias = signal<ContratoTransferencia[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly form = signal<Formulario>('none');
  protected readonly objetivo = signal<ContratoTransferencia | null>(null);

  protected readonly segmentos = computed(() => ordenarSegmentos(this.transferencias()));

  // Formulario: proponer
  protected readonly pFrom = signal('');
  protected readonly pTo = signal('');
  protected readonly pCriterio = signal('');
  protected readonly pEstado = signal('');
  protected readonly pResponsable = signal('');
  protected readonly pWorkflow = signal('');
  // Formulario: rechazar
  protected readonly rMotivo = signal('');

  constructor() {
    effect(() => {
      const id = this.tareaId();
      if (id) void this.cargar();
    });
  }

  protected meta(e: ContratoTransferencia['estado']) {
    return estadoTransferenciaMeta(e);
  }
  protected decidible(t: ContratoTransferencia) {
    return puedeDecidirTransferencia(t);
  }

  async cargar() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.transferencias.set(await this.api.transferencias(this.tareaId()));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected abrirPropuesta() {
    this.pFrom.set(this.ejecutorAgentId() ?? '');
    this.form.set('proponer');
  }
  protected abrirRechazo(t: ContratoTransferencia) {
    this.objetivo.set(t);
    this.rMotivo.set('');
    this.form.set('rechazar');
  }
  protected cerrar() {
    this.form.set('none');
    this.objetivo.set(null);
  }

  private nuevoMessageId(): string {
    return (globalThis.crypto?.randomUUID?.() ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }

  private async run(fn: () => Promise<unknown>, ok: string) {
    this.busy.set(true);
    try {
      await fn();
      this.toast.success(ok);
      this.cerrar();
      await this.cargar();
      this.changed.emit();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected proponer() {
    const estado = this.pEstado().trim();
    void this.run(
      () =>
        this.api.proponerHandoff(this.tareaId(), {
          messageId: this.nuevoMessageId(),
          fromAgentId: this.pFrom().trim() || undefined,
          toAgentId: this.pTo().trim() || undefined,
          criterioSiguiente: this.pCriterio().trim() || undefined,
          estadoAlcanzado: estado ? { resumen: estado } : undefined,
          responsableEntranteUserId: this.pResponsable().trim() || undefined,
          workflowId: this.pWorkflow().trim() || undefined,
        }),
      'Handoff propuesto',
    );
    this.pTo.set('');
    this.pCriterio.set('');
    this.pEstado.set('');
    this.pResponsable.set('');
    this.pWorkflow.set('');
  }

  protected aceptar(t: ContratoTransferencia) {
    void this.run(
      () => this.api.aceptarHandoff(t.id, { messageId: this.nuevoMessageId(), aceptaAgentId: t.toAgentId ?? undefined }),
      'Handoff aceptado: el segmento entrante continúa desde el estado persistido',
    );
  }

  protected rechazar(t: ContratoTransferencia) {
    const motivo = this.rMotivo().trim();
    if (!motivo) return;
    void this.run(
      () => this.api.rechazarHandoff(t.id, { messageId: this.nuevoMessageId(), motivo }),
      'Handoff rechazado',
    );
  }
}
