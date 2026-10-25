import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AgentsScopeApi } from '../../core/agents-scope.api';
import type { AgentAnalytics } from '../../core/agents-scope.models';
import { errorMessage } from '../../core/api.service';
import { TrainingApi } from '../../core/training.api';
import type { Feedback, FeedbackStatus } from '../../core/training.models';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { FeedbackReviewItemComponent } from '../agents/training/feedback-review-item.component';
import { formatMs, formatPct } from './supervision.util';

type StatusFilter = FeedbackStatus | 'ALL';

/**
 * Bandeja de supervisión (ADR 0004 D1): `GET /feedback` ya devuelve solo los agentes que el usuario puede editar
 * (ADR 0007 D4), así que cada elemento se puede revisar sin depender del rol del workspace.
 */
@Component({
  selector: 'nx-supervision',
  imports: [
    FormsModule,
    RouterLink,
    IconComponent,
    FeedbackReviewItemComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    LoadingStateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div><h1>Supervisión</h1><p>Respuestas calificadas o corregidas en el chat de los agentes, listas para revisar</p></div>
        <div class="row wrap filters">
          <div class="field"><label for="sv-status">Estado</label>
            <select id="sv-status" class="input" [ngModel]="status()" (ngModelChange)="setStatus($event)">
              @for (s of statuses; track s.id) { <option [value]="s.id">{{ s.label }}</option> }
            </select></div>
          <div class="field"><label for="sv-agent">Agente</label>
            <select id="sv-agent" class="input" [ngModel]="agentId()" (ngModelChange)="agentId.set($event)">
              <option value="">Todos los agentes</option>
              @for (a of agents(); track a.id) { <option [value]="a.id">{{ a.name }}</option> }
            </select></div>
          <button class="btn refresh" [disabled]="loading()" (click)="load()"><nx-icon name="refresh" [size]="15" />Actualizar</button>
        </div>
      </div>

      <section class="card chat-obs">
        <div class="card-title"><h2>Observabilidad del chat</h2><span class="spacer"></span><span class="muted small">Últimos 30 días</span></div>
        @if (analyticsLoading()) {
          <nx-loading-state text="Cargando métricas de chat…" size="sm" />
        } @else if (analyticsError()) {
          <nx-error-state title="No se pudieron cargar las métricas" message="{{ analyticsError() }}" (retry)="loadAnalytics()" />
        } @else if (chat(); as c) {
          <div class="grid grid-4 metrics">
            <div class="metric"><div class="muted small">Tasa de éxito</div><div class="value">{{ pct(c.successRatePct) }}</div></div>
            <div class="metric"><div class="muted small">Canceladas</div><div class="value">{{ c.cancelled }}</div></div>
            <div class="metric"><div class="muted small">Duración · p50 / p95</div><div class="value">{{ ms(c.durationMs?.p50) }} <span class="sep">/</span> {{ ms(c.durationMs?.p95) }}</div></div>
            <div class="metric"><div class="muted small">Primer token (ttft) · p50 / p95</div><div class="value">{{ ms(c.ttftMs?.p50) }} <span class="sep">/</span> {{ ms(c.ttftMs?.p95) }}</div></div>
          </div>
          <p class="muted small obs-foot">{{ c.total }} {{ c.total === 1 ? 'turno registrado' : 'turnos registrados' }} · {{ c.failed }} con error</p>
        } @else {
          <nx-empty-state icon="send" title="Aún no hay turnos de chat registrados"
            description="Cuando los agentes respondan en el chat verá aquí su tasa de éxito, cancelaciones y latencias." />
        }
      </section>

      <p class="muted small mb">Se muestra la retroalimentación de los agentes que usted puede editar: los suyos y los que le compartieron con permiso de edición.</p>

      @if (loading() && !items().length) {
        <nx-loading-state text="Cargando bandeja…" />
      } @else if (error()) {
        <nx-error-state title="No se pudo cargar la bandeja" message="{{ error() }}" (retry)="load()" />
      } @else {
        <p class="muted small count" role="status">{{ visible().length }} {{ visible().length === 1 ? 'elemento' : 'elementos' }}</p>
        <div class="stack">
          @for (fb of visible(); track fb.id) {
            <nx-feedback-review-item [feedback]="fb" [canEdit]="true" [showAgent]="true" (reviewed)="onReviewed($event.feedback)" />
          } @empty {
            <nx-empty-state icon="inbox" [title]="status() === 'PENDING' ? 'Bandeja al día' : 'Sin resultados'">
              <p>{{ status() === 'PENDING' ? 'No hay retroalimentación pendiente de revisión.' : 'No hay retroalimentación con estos filtros.' }}
                Las calificaciones 👎 y correcciones del chat de cada <a routerLink="/agents">agente</a> llegan aquí.</p>
            </nx-empty-state>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .filters { align-items: flex-end; }
    .filters .field { min-width: 170px; }
    .mb { margin-bottom: 16px; }
    .count { margin: 0 0 10px; }
    .chat-obs { margin-bottom: 16px; }
    .chat-obs .metrics { margin-top: 4px; }
    .chat-obs .metric { display: grid; gap: 4px; }
    .chat-obs .value { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .chat-obs .sep { color: var(--muted); font-weight: 400; }
    .chat-obs .obs-foot { margin: 12px 0 0; }
    @media (max-width: 640px) { .filters { width: 100%; } .filters .field { flex: 1; min-width: 140px; } .refresh { width: 100%; justify-content: center; } }
  `,
})
export class SupervisionPage implements OnInit {
  private readonly training = inject(TrainingApi);
  private readonly scope = inject(AgentsScopeApi);
  /** Formateadores puros expuestos a la plantilla (ver `supervision.util.ts`). */
  readonly ms = formatMs;
  readonly pct = formatPct;
  readonly statuses: { id: StatusFilter; label: string }[] = [
    { id: 'PENDING', label: 'Pendientes' },
    { id: 'APPROVED', label: 'Aprobados' },
    { id: 'DISCARDED', label: 'Descartados' },
    { id: 'ALL', label: 'Todos' },
  ];
  readonly status = signal<StatusFilter>('PENDING');
  readonly agentId = signal('');
  readonly items = signal<Feedback[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  /** Agentes presentes en la bandeja (el endpoint no filtra por agente; se filtra aquí). */
  readonly agents = computed(() => {
    const map = new Map<string, string>();
    for (const f of this.items()) map.set(f.agentId, f.agentName);
    return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });
  readonly visible = computed(() => {
    const id = this.agentId();
    return id ? this.items().filter((f) => f.agentId === id) : this.items();
  });

  // Observabilidad del chat (RX-12): `GET /agents/analytics`. Complementaria a la bandeja, se carga aparte.
  readonly analytics = signal<AgentAnalytics | null>(null);
  readonly analyticsLoading = signal(true);
  readonly analyticsError = signal<string | null>(null);
  /** Bloque de chat; `null` cuando aún no hay turnos registrados o mientras no hay datos cargados. */
  readonly chat = computed(() => {
    const a = this.analytics();
    if (!a?.chat || a.chat.total === 0) return null;
    return a.chat;
  });

  ngOnInit() {
    void this.load();
    void this.loadAnalytics();
  }

  async loadAnalytics() {
    this.analyticsLoading.set(true);
    this.analyticsError.set(null);
    try {
      this.analytics.set(await this.scope.analytics());
    } catch (e) {
      this.analytics.set(null);
      this.analyticsError.set(errorMessage(e));
    } finally {
      this.analyticsLoading.set(false);
    }
  }

  setStatus(s: StatusFilter) {
    this.status.set(s);
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const s = this.status();
      const list = await this.training.workspaceFeedback(s === 'ALL' ? undefined : s);
      this.items.set([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      if (this.agentId() && !list.some((f) => f.agentId === this.agentId())) this.agentId.set('');
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  onReviewed(updated: Feedback) {
    // En «Pendientes» el elemento revisado sale de la lista; en el resto se actualiza en su lugar.
    if (this.status() === 'PENDING') this.items.update((l) => l.filter((f) => f.id !== updated.id));
    else this.items.update((l) => l.map((f) => (f.id === updated.id ? { ...f, ...updated } : f)));
  }
}
