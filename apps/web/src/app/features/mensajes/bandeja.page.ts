import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { MessagingApi } from '../../core/messaging.api';
import { ToastService } from '../../core/toast.service';
import type { MensajeAgente, TipoMensaje } from '../../core/messaging.models';
import { TIPOS_MENSAJE } from '../../core/messaging.models';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { PageHeaderComponent } from '../../layout/page-header.component';
import {
  accionesMensaje,
  agruparPorConversacion,
  AUTOR_META,
  autorTipo,
  corto,
  ESTADO_MENSAJE_META,
  estadoMensaje,
  estadoMensajeMeta,
  ordenarPorReciente,
  PRIORIDAD_MENSAJE_LABEL,
  prioridadMensajeBadge,
  tipoMensajeMeta,
  type EstadoMensaje,
} from './mensajes.util';

/**
 * Bandeja de mensajes entre agentes (RF35). Lista los `MensajeAgente` del workspace con su tipo, prioridad, estado
 * (derivado de los hechos enviado/recibido/aceptado/resuelto) y referencias. La CONVERSACIÓN visible es una
 * representación de estos registros (agrupados por hilo de negocio), no un chat libre. Las acciones del ciclo de vida
 * (recibir/aceptar/resolver) y el envío solo se ofrecen con permiso de edición; el servidor es el gate real.
 */
@Component({
  selector: 'nx-bandeja',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    NgTemplateOutlet,
    FormsModule,
    RouterLink,
    IconComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    LoadingStateComponent,
    RelativeTimePipe,
    PageHeaderComponent,
  ],
  template: `
    <div class="page">
      <nx-page-header
        heading="Mensajes"
        description="Comunicación entre agentes: asignaciones, aceptaciones, entregas, devoluciones y escalamientos. La conversación es una representación de registros, no un chat libre">
        <div actions class="head-acc">
          <button class="btn" (click)="load()" [disabled]="loading()">
            <nx-icon name="refresh" [size]="15" />Actualizar
          </button>
          @if (canEdit()) {
            <button class="btn primary" (click)="componer.set(!componer())">
              <nx-icon name="send" [size]="15" />Nuevo mensaje
            </button>
          }
        </div>
      </nx-page-header>

      @if (canEdit() && componer()) {
        <form class="card compose" (ngSubmit)="enviar()">
          <div class="grid">
            <div class="field">
              <label for="c-tipo">Tipo</label>
              <select id="c-tipo" class="input" [(ngModel)]="cTipo" name="tipo">
                @for (t of tipos; track t) {
                  <option [value]="t">{{ tipoMeta(t).label }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="c-prio">Prioridad</label>
              <select id="c-prio" class="input" [(ngModel)]="cPrioridad" name="prio">
                @for (p of [1, 2, 3, 4, 5]; track p) {
                  <option [value]="p">{{ prioridadLabel(p) }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="c-emisor">Emisor (agente, opcional)</label>
              <input id="c-emisor" class="input" [(ngModel)]="cEmisor" name="emisor" placeholder="ID del agente" />
            </div>
            <div class="field">
              <label for="c-dest">Destinatario (agente, opcional)</label>
              <input id="c-dest" class="input" [(ngModel)]="cDestino" name="dest" placeholder="ID del agente" />
            </div>
            <div class="field">
              <label for="c-corr">Hilo de negocio (opcional)</label>
              <input id="c-corr" class="input" [(ngModel)]="cCorrelacion" name="corr" placeholder="correlationId" />
            </div>
            <div class="field">
              <label for="c-tarea">Tarea asociada (opcional)</label>
              <input id="c-tarea" class="input" [(ngModel)]="cTarea" name="tarea" placeholder="ID de tarea" />
            </div>
          </div>
          @if (cTipo() === 'ASIGNACION' && !cTarea().trim()) {
            <div class="field">
              <label for="c-titulo">Título de la tarea asignada</label>
              <input id="c-titulo" class="input" [(ngModel)]="cTitulo" name="titulo"
                placeholder="Se crea la tarea una sola vez (idempotente)" />
            </div>
          }
          <p class="hint" role="note">
            El envío es idempotente por una clave generada automáticamente. Un mensaje no autoriza efectos ni amplía
            permisos (RF09).
          </p>
          <div class="acciones">
            <button type="submit" class="btn primary" [disabled]="busy()">Enviar</button>
            <button type="button" class="btn ghost" (click)="componer.set(false)">Cancelar</button>
          </div>
        </form>
      }

      @if (loading()) {
        <nx-loading-state text="Cargando los mensajes…" />
      } @else if (error()) {
        <nx-error-state message="{{ error() }}" (retry)="load()" />
      } @else {
        <div class="filtros" role="group" aria-label="Filtros">
          <div class="field">
            <label for="f-tipo">Tipo</label>
            <select id="f-tipo" class="input" [value]="fTipo()" (change)="fTipo.set($any($event.target).value)">
              <option value="">Todos</option>
              @for (t of tipos; track t) {
                <option [value]="t">{{ tipoMeta(t).label }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label for="f-estado">Estado</label>
            <select id="f-estado" class="input" [value]="fEstado()" (change)="fEstado.set($any($event.target).value)">
              <option value="">Todos</option>
              @for (e of estados; track e) {
                <option [value]="e">{{ estadoLabel(e) }}</option>
              }
            </select>
          </div>
          <div class="field toggle">
            <label for="f-agrupar">Vista</label>
            <select id="f-agrupar" class="input" [value]="agrupar() ? 'conv' : 'plano'"
              (change)="agrupar.set($any($event.target).value === 'conv')">
              <option value="conv">Por conversación</option>
              <option value="plano">Lista plana</option>
            </select>
          </div>
        </div>

        @if (visibles().length) {
          <p class="conteo" aria-live="polite">{{ visibles().length }} mensaje(s)</p>
          @if (agrupar()) {
            <div class="convs">
              @for (c of conversaciones(); track c.clave) {
                <section class="card conv">
                  <header class="conv-head">
                    <nx-icon name="branch" [size]="15" />
                    <span class="hilo">{{ c.correlationId ? ('Hilo ' + corto(c.correlationId)) : 'Mensaje suelto' }}</span>
                    <span class="badge">{{ c.mensajes.length }}</span>
                  </header>
                  <ol class="timeline">
                    @for (m of c.mensajes; track m.id) {
                      <li>
                        <ng-container [ngTemplateOutlet]="fila" [ngTemplateOutletContext]="{ m }" />
                      </li>
                    }
                  </ol>
                </section>
              }
            </div>
          } @else {
            <ul class="lista">
              @for (m of visibles(); track m.id) {
                <li class="card">
                  <ng-container [ngTemplateOutlet]="fila" [ngTemplateOutletContext]="{ m }" />
                </li>
              }
            </ul>
          }
        } @else {
          <nx-empty-state icon="inbox" title="Bandeja vacía"
            description="No hay mensajes con estos filtros. Los mensajes aparecen cuando los agentes se asignan trabajo, aceptan, entregan o escalan." />
        }
      }
    </div>

    <!-- Fila de un mensaje (reutilizada en vista agrupada y plana). -->
    <ng-template #fila let-m="m">
      <div class="msg">
        <div class="msg-top">
          <span class="badge {{ tipoMeta(m.tipo).badge }}" title="Tipo de mensaje">
            <nx-icon [name]="tipoMeta(m.tipo).icon" [size]="13" />{{ tipoMeta(m.tipo).label }}
          </span>
          <span class="badge {{ estadoMeta(m).badge }}" title="Estado por hechos del ciclo de vida">
            {{ estadoMeta(m).label }}
          </span>
          <span class="badge {{ prioBadge(m.prioridad) }}">P{{ m.prioridad }} · {{ prioridadLabel(m.prioridad) }}</span>
          @if (m.yaExistia) {
            <span class="badge info" title="Una redelivery devolvió el mensaje existente">Idempotente</span>
          }
        </div>
        <div class="msg-actores">
          <span class="actor" [title]="autorMeta(m.emisorAgentId).label + ' emisor'">
            <nx-icon [name]="autorMeta(m.emisorAgentId).icon" [size]="14" />{{ emisorTxt(m) }}
          </span>
          <nx-icon class="flecha" name="arrowLeft" [size]="14" />
          <span class="actor" [title]="'Destinatario'">
            <nx-icon [name]="destIcon(m)" [size]="14" />{{ destinoTxt(m) }}
          </span>
        </div>
        <div class="msg-meta">
          <span><nx-icon name="clock" [size]="12" />{{ m.enviadoAt | ago }} · {{ m.enviadoAt | date: 'short' }}</span>
          @if (m.tareaId) {
            <a [routerLink]="['/trabajo/tareas', m.tareaId]"><nx-icon name="list" [size]="12" />Tarea</a>
          }
          @if (m.referencias.length) {
            <span><nx-icon name="link" [size]="12" />{{ m.referencias.length }} referencia(s)</span>
          }
          @if (m.fechaLimite) {
            <span><nx-icon name="flag" [size]="12" />Límite {{ m.fechaLimite | date: 'short' }}</span>
          }
        </div>
        @if (m.motivo) {
          <p class="motivo"><nx-icon name="info" [size]="12" />{{ m.motivo }}</p>
        }
        @if (canEdit()) {
          <div class="msg-acc">
            @if (acciones(m).recibir) {
              <button class="btn sm" [disabled]="accionBusy() === m.id" (click)="recibir(m)">
                <nx-icon name="inbox" [size]="13" />Recibir
              </button>
            }
            @if (acciones(m).aceptar) {
              <button class="btn sm" [disabled]="accionBusy() === m.id" (click)="aceptar(m)">
                <nx-icon name="check" [size]="13" />Aceptar
              </button>
            }
            @if (acciones(m).resolver) {
              <button class="btn sm" [disabled]="accionBusy() === m.id" (click)="resolverAbrir(m)">
                <nx-icon name="checkCircle" [size]="13" />Resolver
              </button>
            }
          </div>
          @if (resolverTarget() === m.id) {
            <form class="mini" (ngSubmit)="resolverConfirmar(m)">
              <div class="field">
                <label for="r-{{ m.id }}">
                  Motivo {{ acciones(m).motivoRequeridoAlResolver ? '(obligatorio en devoluciones)' : '(opcional)' }}
                </label>
                <input id="r-{{ m.id }}" class="input" [(ngModel)]="resolverMotivo" name="motivo" />
              </div>
              <div class="acciones">
                <button type="submit" class="btn sm primary"
                  [disabled]="acciones(m).motivoRequeridoAlResolver && !resolverMotivo().trim()">Resolver</button>
                <button type="button" class="btn sm ghost" (click)="resolverTarget.set(null)">Cancelar</button>
              </div>
            </form>
          }
        }
      </div>
    </ng-template>
  `,
  styles: `
    .head-acc { display: flex; gap: 8px; flex-wrap: wrap; }
    .compose { display: flex; flex-direction: column; gap: 12px; margin-bottom: 18px; }
    .compose .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .filtros { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 18px; }
    .conteo { margin: 0 0 10px; color: var(--muted); font-size: 13px; }
    .lista, .convs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
    .conv { display: flex; flex-direction: column; gap: 10px; }
    .conv-head { display: flex; align-items: center; gap: 8px; font-weight: 650; font-size: 14px; }
    .conv-head .hilo { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
    .timeline > li { border-left: 2px solid var(--border); padding-left: 12px; }
    .msg { display: flex; flex-direction: column; gap: 6px; }
    .msg-top { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .msg-actores { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .msg-actores .actor { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 600; }
    .msg-actores .flecha { transform: rotate(180deg); color: var(--muted); }
    .msg-meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--muted); }
    .msg-meta span, .msg-meta a { display: inline-flex; align-items: center; gap: 4px; }
    .msg-meta a { color: var(--primary); }
    .motivo { margin: 0; font-size: 12.5px; color: var(--muted); display: inline-flex; align-items: center; gap: 5px; }
    .msg-acc { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px; }
    .mini { display: flex; flex-direction: column; gap: 10px; background: var(--surface-2); padding: 12px; border-radius: 10px; margin-top: 6px; }
    .hint { margin: 0; font-size: 12px; color: var(--muted); }
    .acciones { display: flex; flex-wrap: wrap; gap: 8px; }
  `,
})
export class BandejaPage implements OnInit {
  private readonly api = inject(MessagingApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly tipos = TIPOS_MENSAJE;
  protected readonly estados: readonly EstadoMensaje[] = ['ENVIADO', 'RECIBIDO', 'ACEPTADO', 'RESUELTO'];
  protected readonly corto = corto;

  protected readonly mensajes = signal<MensajeAgente[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly accionBusy = signal<string | null>(null);

  protected readonly canEdit = computed(() => this.auth.canEdit());
  protected readonly componer = signal(false);
  protected readonly agrupar = signal(true);

  protected readonly fTipo = signal<TipoMensaje | ''>('');
  protected readonly fEstado = signal<EstadoMensaje | ''>('');

  // Resolver inline
  protected readonly resolverTarget = signal<string | null>(null);
  protected readonly resolverMotivo = signal('');

  // Compose
  protected readonly cTipo = signal<TipoMensaje>('ASIGNACION');
  protected readonly cPrioridad = signal(3);
  protected readonly cEmisor = signal('');
  protected readonly cDestino = signal('');
  protected readonly cCorrelacion = signal('');
  protected readonly cTarea = signal('');
  protected readonly cTitulo = signal('');

  protected readonly visibles = computed(() => {
    const tipo = this.fTipo();
    const estado = this.fEstado();
    return this.mensajes()
      .filter((m) => (tipo ? m.tipo === tipo : true))
      .filter((m) => (estado ? estadoMensaje(m) === estado : true))
      .sort(ordenarPorReciente);
  });
  protected readonly conversaciones = computed(() => agruparPorConversacion(this.visibles()));

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.mensajes.set(await this.api.mensajes());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  // ---- Presentación ----
  protected tipoMeta = tipoMensajeMeta;
  protected estadoMeta = estadoMensajeMeta;
  protected acciones = accionesMensaje;
  protected prioBadge = prioridadMensajeBadge;
  protected prioridadLabel(p: number) {
    return PRIORIDAD_MENSAJE_LABEL[p] ?? String(p);
  }
  protected estadoLabel(e: EstadoMensaje) {
    return ESTADO_MENSAJE_META[e].label;
  }
  protected autorMeta(agentId: string | null) {
    return AUTOR_META[autorTipo(agentId)];
  }
  protected emisorTxt(m: MensajeAgente) {
    return m.emisorAgentId ? corto(m.emisorAgentId) : 'Sistema';
  }
  protected destIcon(m: MensajeAgente) {
    if (m.destinatarioAgentId) return 'bot';
    if (m.destinatarioEquipoId) return 'users';
    if (m.canalId) return 'branch';
    return 'user';
  }
  protected destinoTxt(m: MensajeAgente) {
    if (m.destinatarioAgentId) return corto(m.destinatarioAgentId);
    if (m.destinatarioEquipoId) return `Equipo ${corto(m.destinatarioEquipoId)}`;
    if (m.canalId) return `Canal ${corto(m.canalId)}`;
    return 'Sin destinatario';
  }

  // ---- Acciones del ciclo de vida ----
  private async accion(id: string, fn: () => Promise<unknown>, ok: string) {
    this.accionBusy.set(id);
    try {
      await fn();
      this.toast.success(ok);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.accionBusy.set(null);
    }
  }

  protected recibir(m: MensajeAgente) {
    void this.accion(m.id, () => this.api.recibir(m.id), 'Recepción registrada');
  }
  protected aceptar(m: MensajeAgente) {
    void this.accion(m.id, () => this.api.aceptar(m.id), 'Aceptación registrada');
  }
  protected resolverAbrir(m: MensajeAgente) {
    if (accionesMensaje(m).motivoRequeridoAlResolver) {
      this.resolverMotivo.set('');
      this.resolverTarget.set(m.id);
    } else {
      void this.accion(m.id, () => this.api.resolver(m.id), 'Mensaje resuelto');
    }
  }
  protected resolverConfirmar(m: MensajeAgente) {
    const motivo = this.resolverMotivo().trim();
    if (accionesMensaje(m).motivoRequeridoAlResolver && !motivo) return;
    void this.accion(m.id, () => this.api.resolver(m.id, { motivo: motivo || undefined }), 'Mensaje resuelto');
    this.resolverTarget.set(null);
  }

  // ---- Envío ----
  protected enviar() {
    const tipo = this.cTipo();
    const tareaId = this.cTarea().trim();
    const titulo = this.cTitulo().trim();
    this.busy.set(true);
    this.api
      .enviar({
        messageId: globalThis.crypto?.randomUUID?.() ?? `msg-${Date.now()}`,
        tipo,
        prioridad: Number(this.cPrioridad()),
        emisorAgentId: this.cEmisor().trim() || undefined,
        destinatarioAgentId: this.cDestino().trim() || undefined,
        correlationId: this.cCorrelacion().trim() || undefined,
        tareaId: tareaId || undefined,
        tarea: tipo === 'ASIGNACION' && !tareaId && titulo ? { titulo } : undefined,
      })
      .then(() => {
        this.toast.success('Mensaje enviado');
        this.componer.set(false);
        this.cDestino.set('');
        this.cCorrelacion.set('');
        this.cTarea.set('');
        this.cTitulo.set('');
        return this.load();
      })
      .catch((e) => this.toast.error(errorMessage(e)))
      .finally(() => this.busy.set(false));
  }
}
