import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ResultsApi } from '../../core/results.api';
import type { Agent } from '../../core/models';
import type { EstadoTarea, Tarea } from '../../core/results.models';
import { ESTADOS_TAREA } from '../../core/results.models';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { PageHeaderComponent } from '../../layout/page-header.component';
import {
  esMiTarea,
  estadoResultadoMeta,
  estadoTareaMeta,
  ordenarPorUrgencia,
  PRIORIDAD_LABEL,
  prioridadBadge,
  siguientePaso,
  tareaVencida,
} from './trabajo.util';

type VenceFiltro = 'todas' | 'vencidas' | 'semana' | 'sin';

/**
 * «Mi trabajo» (RF24/HU12/§8): las tareas del usuario y de sus agentes, ordenadas por urgencia, con el siguiente paso
 * y el estado operativo. Filtros por estado, prioridad y fecha límite. Distingue el estado OPERATIVO del estado del
 * RESULTADO. Estados de carga, vacío y error compartidos. No inventa datos.
 */
@Component({
  selector: 'nx-mi-trabajo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    IconComponent,
    ErrorStateComponent,
    EmptyStateComponent,
    LoadingStateComponent,
    RelativeTimePipe,
    PageHeaderComponent,
  ],
  template: `
    <div class="page">
      <nx-page-header heading="Mi trabajo" description="Tus tareas y las de tus agentes, por urgencia: qué sigue y en qué estado está">
        <button actions class="btn" (click)="load()" [disabled]="loading()">
          <nx-icon name="refresh" [size]="15" />Actualizar
        </button>
      </nx-page-header>

      @if (loading()) {
        <nx-loading-state text="Cargando tu trabajo…" />
      } @else if (error()) {
        <nx-error-state message="{{ error() }}" (retry)="load()" />
      } @else {
        <div class="filtros" role="group" aria-label="Filtros">
          <div class="field">
            <label for="f-alcance">Alcance</label>
            <select id="f-alcance" class="input" [value]="alcance()" (change)="alcance.set($any($event.target).value)">
              <option value="mias">Mías y de mis agentes</option>
              <option value="todas">Todas del workspace</option>
            </select>
          </div>
          <div class="field">
            <label for="f-estado">Estado</label>
            <select id="f-estado" class="input" [value]="fEstado()" (change)="fEstado.set($any($event.target).value)">
              <option value="">Todos</option>
              @for (e of estados; track e) {
                <option [value]="e">{{ metaOp(e).label }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label for="f-prioridad">Prioridad</label>
            <select id="f-prioridad" class="input" [value]="fPrioridad()" (change)="fPrioridad.set($any($event.target).value)">
              <option value="">Todas</option>
              @for (p of [1, 2, 3, 4, 5]; track p) {
                <option [value]="p">{{ prioridadLabel(p) }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label for="f-vence">Fecha límite</label>
            <select id="f-vence" class="input" [value]="fVence()" (change)="fVence.set($any($event.target).value)">
              <option value="todas">Todas</option>
              <option value="vencidas">Vencidas</option>
              <option value="semana">Próximos 7 días</option>
              <option value="sin">Sin fecha</option>
            </select>
          </div>
        </div>

        @if (visibles().length) {
          <p class="conteo" aria-live="polite">{{ visibles().length }} tarea(s)</p>
          <ul class="lista">
            @for (t of visibles(); track t.id) {
              <li class="card hover" [class.urgente]="esVencida(t)">
                <a class="titulo" [routerLink]="['/trabajo/tareas', t.id]">{{ t.titulo }}</a>
                <div class="badges">
                  <span class="badge {{ metaOp(t.estado).badge }}" title="Estado operativo">
                    <nx-icon name="list" [size]="12" />{{ metaOp(t.estado).label }}
                  </span>
                  @if (t.contratoResultado; as c) {
                    <span class="badge {{ metaRes(c.estado).badge }}" title="Estado del resultado">
                      <nx-icon name="target" [size]="12" />{{ metaRes(c.estado).label }}
                    </span>
                  } @else {
                    <span class="badge" title="Sin contrato de resultado">
                      <nx-icon name="target" [size]="12" />Sin contrato
                    </span>
                  }
                  <span class="badge {{ prioBadge(t.prioridad) }}">P{{ t.prioridad }} · {{ prioridadLabel(t.prioridad) }}</span>
                </div>
                <p class="paso">{{ paso(t) }}</p>
                <div class="pie">
                  @if (t.fechaLimite) {
                    <span [class.vencida]="esVencida(t)">
                      <nx-icon name="clock" [size]="13" />{{ esVencida(t) ? 'Venció ' : 'Vence ' }}{{ t.fechaLimite | ago }}
                      · {{ t.fechaLimite | date: 'shortDate' }}
                    </span>
                  } @else {
                    <span class="muted"><nx-icon name="clock" [size]="13" />Sin fecha límite</span>
                  }
                </div>
              </li>
            }
          </ul>
        } @else {
          <nx-empty-state
            icon="checkCircle"
            title="Nada pendiente aquí"
            [description]="alcance() === 'mias' ? 'No tienes tareas asignadas con estos filtros.' : 'No hay tareas con estos filtros.'" />
        }
      }
    </div>
  `,
  styles: `
    .filtros { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 18px; }
    .conteo { margin: 0 0 10px; color: var(--muted); font-size: 13px; }
    .lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
    .lista li { display: flex; flex-direction: column; gap: 8px; }
    .lista li.urgente { border-left: 3px solid var(--danger); }
    .titulo { font-weight: 650; font-size: 15px; color: var(--text); }
    .titulo:hover { color: var(--primary); }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; }
    .paso { margin: 0; font-size: 13px; color: var(--muted); }
    .pie { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12.5px; color: var(--muted); }
    .pie span { display: inline-flex; align-items: center; gap: 5px; }
    .pie .vencida { color: var(--danger); font-weight: 600; }
  `,
})
export class MiTrabajoPage implements OnInit {
  private readonly results = inject(ResultsApi);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  protected readonly estados = ESTADOS_TAREA;

  protected readonly tareas = signal<Tarea[]>([]);
  protected readonly misAgentes = signal<Set<string>>(new Set());
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly alcance = signal<'mias' | 'todas'>('mias');
  protected readonly fEstado = signal<EstadoTarea | ''>('');
  protected readonly fPrioridad = signal<string>('');
  protected readonly fVence = signal<VenceFiltro>('todas');

  protected readonly visibles = computed(() => {
    const userId = this.auth.me()?.id ?? null;
    const agentes = this.misAgentes();
    const estado = this.fEstado();
    const prioridad = this.fPrioridad();
    const vence = this.fVence();
    const ahora = Date.now();
    const semana = ahora + 7 * 24 * 3_600_000;
    return this.tareas()
      .filter((t) => (this.alcance() === 'mias' ? esMiTarea(t, userId, agentes) : true))
      .filter((t) => (estado ? t.estado === estado : true))
      .filter((t) => (prioridad ? t.prioridad === Number(prioridad) : true))
      .filter((t) => this.pasaVence(t, vence, ahora, semana))
      .sort((a, b) => ordenarPorUrgencia(a, b, ahora));
  });

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const userId = this.auth.me()?.id ?? null;
      const [tareas, agents] = await Promise.all([
        this.results.tareas(),
        this.api.agents().catch(() => [] as Agent[]),
      ]);
      this.tareas.set(tareas);
      // Mis agentes: de los que soy responsable, suplente o dueño (referencias blandas).
      this.misAgentes.set(
        new Set(
          agents
            .filter((a) => a.responsableUserId === userId || a.suplenteUserId === userId || a.ownerId === userId)
            .map((a) => a.id),
        ),
      );
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  private pasaVence(t: Tarea, filtro: VenceFiltro, ahora: number, semana: number): boolean {
    if (filtro === 'todas') return true;
    if (filtro === 'sin') return !t.fechaLimite;
    if (!t.fechaLimite) return false;
    if (filtro === 'vencidas') return tareaVencida(t, ahora);
    const ts = new Date(t.fechaLimite).getTime();
    return ts >= ahora && ts <= semana;
  }

  protected esVencida(t: Tarea) {
    return tareaVencida(t);
  }
  protected paso(t: Tarea) {
    return siguientePaso(t);
  }
  protected metaOp(e: EstadoTarea) {
    return estadoTareaMeta(e);
  }
  protected metaRes = estadoResultadoMeta;
  protected prioridadLabel(p: number) {
    return PRIORIDAD_LABEL[p] ?? String(p);
  }
  protected prioBadge(p: number) {
    return prioridadBadge(p);
  }
}
