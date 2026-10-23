import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { TrainingApi } from '../../core/training.api';
import type { Feedback, FeedbackStatus } from '../../core/training.models';
import { IconComponent } from '../../shared/icon.component';
import { FeedbackReviewItemComponent } from '../agents/training/feedback-review-item.component';

type StatusFilter = FeedbackStatus | 'ALL';

/** Bandeja de supervisión del workspace (ADR 0004 D1): retroalimentación del chat de todos los agentes. */
@Component({
  selector: 'nx-supervision',
  imports: [FormsModule, RouterLink, IconComponent, FeedbackReviewItemComponent],
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

      @if (!auth.canEdit()) {
        <div class="callout info mb"><nx-icon name="info" [size]="16" /><span>Tiene acceso de lectura: puede consultar la bandeja, pero solo los editores aprueban o descartan.</span></div>
      }

      @if (loading() && !items().length) {
        <div class="card empty"><p>Cargando bandeja…</p></div>
      } @else if (error()) {
        <div class="card empty"><nx-icon name="alert" [size]="28" /><h3>No se pudo cargar la bandeja</h3><p>{{ error() }}</p>
          <button class="btn" (click)="load()">Reintentar</button></div>
      } @else {
        <p class="muted small count" role="status">{{ visible().length }} {{ visible().length === 1 ? 'elemento' : 'elementos' }}</p>
        <div class="stack">
          @for (fb of visible(); track fb.id) {
            <nx-feedback-review-item [feedback]="fb" [canEdit]="auth.canEdit()" [showAgent]="true" (reviewed)="onReviewed($event.feedback)" />
          } @empty {
            <div class="card empty"><nx-icon name="inbox" [size]="36" /><h3>{{ status() === 'PENDING' ? 'Bandeja al día' : 'Sin resultados' }}</h3>
              <p>{{ status() === 'PENDING' ? 'No hay retroalimentación pendiente de revisión.' : 'No hay retroalimentación con estos filtros.' }}
                Las calificaciones 👎 y correcciones del chat de cada <a routerLink="/agents">agente</a> llegan aquí.</p></div>
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
    @media (max-width: 640px) { .filters { width: 100%; } .filters .field { flex: 1; min-width: 140px; } .refresh { width: 100%; justify-content: center; } }
  `,
})
export class SupervisionPage implements OnInit {
  private readonly training = inject(TrainingApi);
  protected readonly auth = inject(AuthService);
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

  ngOnInit() {
    void this.load();
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
