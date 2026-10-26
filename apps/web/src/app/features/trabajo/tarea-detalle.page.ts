import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ResultsApi } from '../../core/results.api';
import { ToastService } from '../../core/toast.service';
import type { EstadoTarea, Incumplimiento, TareaDetalle } from '../../core/results.models';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { PageHeaderComponent } from '../../layout/page-header.component';
import { ContratoPanelComponent } from './contrato-panel.component';
import {
  estadoTareaMeta,
  PRIORIDAD_LABEL,
  prioridadBadge,
  puedeCompletarTarea,
  siguientePaso,
  tareaVencida,
  transicionesTarea,
} from './trabajo.util';

/**
 * Detalle de tarea/resultado (RF08/RF29/RF30). Separa visualmente el estado OPERATIVO (`EstadoTarea`) del estado del
 * RESULTADO (`EstadoResultado`, en `nx-contrato-panel`): son ortogonales. Las acciones que modifican datos solo se
 * muestran con permiso de edición; el servidor es el gate real y sus errores (p. ej. completar sin resultado
 * ACEPTADO, HU15) se muestran con el `ToastService`.
 */
@Component({
  selector: 'nx-tarea-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    IconComponent,
    ErrorStateComponent,
    LoadingStateComponent,
    EmptyStateComponent,
    RelativeTimePipe,
    PageHeaderComponent,
    ContratoPanelComponent,
  ],
  template: `
    <div class="page">
      @if (loading()) {
        <nx-loading-state text="Cargando la tarea…" />
      } @else if (error()) {
        <nx-error-state title="No se pudo cargar la tarea" message="{{ error() }}" (retry)="load()" />
      } @else if (tarea(); as t) {
        <nx-page-header
          [heading]="t.titulo"
          [crumbs]="[{ label: 'Mi trabajo', link: '/trabajo' }, { label: 'Tarea' }]">
          <a lead class="btn ghost icon" routerLink="/trabajo" title="Volver a Mi trabajo" aria-label="Volver">
            <nx-icon name="arrowLeft" [size]="18" />
          </a>
          <div meta class="chips">
            <span class="badge {{ opMeta(t.estado).badge }}" title="Estado operativo de la tarea">
              <nx-icon name="list" [size]="13" />{{ opMeta(t.estado).label }}
            </span>
            <span class="badge {{ prioBadge(t.prioridad) }}">Prioridad {{ prioridad(t.prioridad) }}</span>
            @if (vencida()) {
              <span class="badge danger"><nx-icon name="clock" [size]="13" />Vencida</span>
            }
            @if (t.objetivo; as o) {
              <a class="badge" [routerLink]="['/trabajo/objetivos']" [queryParams]="{ objetivo: o.id }">
                <nx-icon name="target" [size]="13" />{{ o.codigo }}
              </a>
            }
          </div>
        </nx-page-header>

        <div class="layout">
          <section class="card operativo">
            <header class="card-title">
              <nx-icon name="list" [size]="18" />
              <h2>Operación</h2>
            </header>
            <p class="siguiente"><strong>Siguiente paso:</strong> {{ paso() }}</p>
            @if (t.descripcion) {
              <p class="desc">{{ t.descripcion }}</p>
            }
            <dl class="campos">
              @if (t.criterioAceptacion) {
                <dt>Criterio de aceptación</dt>
                <dd>{{ t.criterioAceptacion }}</dd>
              }
              <dt>Fecha límite</dt>
              <dd>{{ t.fechaLimite ? (t.fechaLimite | date: 'medium') : 'Sin fecha' }}</dd>
              <dt>Ejecutor</dt>
              <dd>{{ t.responsableAgentId ? 'Agente ' + corto(t.responsableAgentId) : (t.equipoId ? 'Equipo' : 'Sin asignar') }}</dd>
              <dt>Dueño</dt>
              <dd>{{ t.duenoUserId ? ('Persona ' + corto(t.duenoUserId)) : 'Sin dueño' }}</dd>
            </dl>

            @if (canEdit()) {
              <div class="acciones">
                @for (e of transiciones(); track e) {
                  <button
                    class="btn"
                    [class.primary]="e === 'COMPLETADA'"
                    [disabled]="busy()"
                    [title]="hintTransicion(e)"
                    (click)="cambiar(e)">
                    {{ opMeta(e).label }}
                  </button>
                }
              </div>
              @if (transiciones().includes('COMPLETADA') && !completable()) {
                <p class="hint" role="note">
                  Para completar, el resultado debe estar ACEPTADO (verificado), no solo ejecutado (HU15).
                </p>
              }
            }
          </section>

          <nx-contrato-panel [tarea]="t" [canEdit]="canEdit()" (changed)="load()" />

          <section class="card">
            <header class="card-title">
              <nx-icon name="alert" [size]="18" />
              <h2>Incumplimientos</h2>
            </header>
            @if (t.incumplimientos.length) {
              <ul class="inc">
                @for (i of t.incumplimientos; track i.id) {
                  <li>
                    <span class="badge" [class.danger]="!i.resuelto" [class.success]="i.resuelto">
                      {{ i.resuelto ? (i.resolucion || 'Resuelto') : 'Abierto' }}
                    </span>
                    <div class="body">
                      <p class="causa">{{ i.causa }}</p>
                      <div class="meta">
                        <span>Reintentos {{ i.intentos }}/{{ i.maxReintentos || '∞' }}</span>
                        <span>Ciclos {{ i.ciclos }}/{{ i.maxCiclos || '∞' }}</span>
                        <span>{{ i.createdAt | ago }}</span>
                      </div>
                    </div>
                    @if (canEdit() && !i.resuelto) {
                      <button class="btn sm" [disabled]="busy()" (click)="intento(i)" title="Registrar un intento de corrección">
                        <nx-icon name="repeat" [size]="14" />Intento
                      </button>
                    }
                  </li>
                }
              </ul>
            } @else {
              <nx-empty-state icon="checkCircle" title="Sin incumplimientos" description="No hay planes de recuperación abiertos." />
            }
          </section>
        </div>
      }
    </div>
  `,
  styles: `
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .chips a.badge { cursor: pointer; }
    .layout { display: flex; flex-direction: column; gap: 18px; }
    .card-title h2 { font-size: 16px; margin: 0; }
    .operativo { display: flex; flex-direction: column; gap: 12px; }
    .siguiente { margin: 0; padding: 10px 12px; background: var(--primary-50); color: var(--primary); border-radius: 9px; font-size: 13.5px; }
    .desc { margin: 0; font-size: 14px; }
    .campos { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; }
    .campos dt { color: var(--muted); font-size: 12.5px; font-weight: 600; }
    .campos dd { margin: 0; font-size: 13.5px; }
    .acciones { display: flex; flex-wrap: wrap; gap: 8px; }
    .hint { margin: 0; font-size: 12.5px; color: var(--muted); }
    .inc { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
    .inc li { display: flex; gap: 10px; align-items: flex-start; }
    .inc .body { flex: 1; min-width: 0; }
    .inc .causa { margin: 0; font-size: 13.5px; }
    .inc .meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--muted); margin-top: 3px; }
    @media (min-width: 900px) { .layout { display: grid; grid-template-columns: 1fr 1fr; align-items: start; } .layout > nx-contrato-panel { grid-row: span 2; } }
    @media (max-width: 560px) { .campos { grid-template-columns: 1fr; gap: 2px 0; } }
  `,
})
export class TareaDetallePage implements OnInit {
  private readonly api = inject(ResultsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly tarea = signal<TareaDetalle | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly canEdit = computed(() => this.auth.canEdit());
  protected readonly transiciones = computed(() => {
    const t = this.tarea();
    return t ? transicionesTarea(t.estado) : [];
  });
  protected readonly completable = computed(() => {
    const t = this.tarea();
    return !!t && puedeCompletarTarea(t.estado, t.contratoResultado);
  });
  protected readonly paso = computed(() => {
    const t = this.tarea();
    return t ? siguientePaso(t) : '';
  });
  protected readonly vencida = computed(() => {
    const t = this.tarea();
    return !!t && tareaVencida(t);
  });

  ngOnInit() {
    void this.load();
  }

  async load() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('Tarea no encontrada');
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      this.tarea.set(await this.api.tarea(id));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected opMeta(e: EstadoTarea) {
    return estadoTareaMeta(e);
  }
  protected prioridad(p: number) {
    return PRIORIDAD_LABEL[p] ?? p;
  }
  protected prioBadge(p: number) {
    return prioridadBadge(p);
  }
  protected corto(id: string) {
    return `…${id.slice(-6)}`;
  }
  protected hintTransicion(e: EstadoTarea): string {
    return e === 'COMPLETADA' && !this.completable()
      ? 'Requiere que el resultado esté ACEPTADO (verificado)'
      : `Pasar a ${estadoTareaMeta(e).label}`;
  }

  protected async cambiar(estado: EstadoTarea) {
    const t = this.tarea();
    if (!t) return;
    this.busy.set(true);
    try {
      await this.api.cambiarEstadoTarea(t.id, { estado });
      this.toast.success('Estado actualizado');
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async intento(i: Incumplimiento) {
    this.busy.set(true);
    try {
      await this.api.registrarIntento(i.id, { reintento: true });
      this.toast.success('Intento registrado');
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
