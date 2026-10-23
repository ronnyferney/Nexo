import { ChangeDetectionStrategy, Component, inject, input, OnInit, output, signal } from '@angular/core';
import { errorMessage } from '../../../core/api.service';
import type { Agent } from '../../../core/models';
import { TrainingApi } from '../../../core/training.api';
import type { PromptSuggestion } from '../../../core/training.models';
import { ToastService } from '../../../core/toast.service';
import { DiffViewComponent } from '../../../shared/diff-view.component';
import { IconComponent } from '../../../shared/icon.component';
import { RelativeTimePipe } from '../../../shared/relative-time.pipe';
import { profileToText } from './training-utils';

const STATUS: Record<PromptSuggestion['status'], { cls: string; label: string }> = {
  PENDING: { cls: 'warning', label: 'Pendiente' },
  APPLIED: { cls: 'success', label: 'Aplicada' },
  REJECTED: { cls: '', label: 'Rechazada' },
};

/** Paso «Mejorar»: sugerencias de la IA con justificación y diff contra la configuración actual; aplicar o rechazar. */
@Component({
  selector: 'nx-training-suggestions',
  imports: [IconComponent, RelativeTimePipe, DiffViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      @if (justApplied()) {
        <div class="callout info" role="status"><nx-icon name="checkCircle" [size]="16" />
          <span class="grow">Sugerencia aplicada: se guardó una versión previa y el agente se actualizó. Vuelva a evaluar para medir el efecto.</span>
          <button class="btn sm primary" (click)="reevaluate.emit()"><nx-icon name="beaker" [size]="14" />Volver a evaluar</button></div>
      }
      <div class="row wrap">
        <p class="muted small m0 grow">Genere sugerencias desde el detalle de una corrida en «Evaluar». Nunca se aplican solas: revise el diff y decida.</p>
        <button class="btn sm" [disabled]="loading()" (click)="load()"><nx-icon name="refresh" [size]="14" />Actualizar</button>
      </div>

      @if (loading() && !items().length) {
        <div class="card empty"><p>Cargando sugerencias…</p></div>
      } @else if (error()) {
        <div class="card empty"><nx-icon name="alert" [size]="28" /><h3>No se pudieron cargar las sugerencias</h3><p>{{ error() }}</p>
          <button class="btn" (click)="load()">Reintentar</button></div>
      } @else {
        @for (s of items(); track s.id) {
          <article class="card stack sug" [class.pending]="s.status === 'PENDING'" [attr.aria-label]="'Sugerencia ' + (s.createdAt | ago)">
            <div class="row wrap">
              <nx-icon name="sparkles" [size]="16" /><strong>Sugerencia de mejora</strong>
              <span class="badge {{ status(s).cls }}">{{ status(s).label }}</span>
              <span class="spacer"></span><span class="muted small">{{ s.createdAt | ago }}</span>
            </div>
            <div class="rationale"><span class="tag">Justificación</span><p>{{ s.rationale }}</p></div>
            @if (s.status === 'PENDING') {
              @if (s.proposal.systemPrompt !== undefined) {
                <nx-diff label="Instrucciones (system prompt)" [before]="agent().systemPrompt" [after]="s.proposal.systemPrompt" />
              }
              @if (s.proposal.profile) {
                <nx-diff label="Perfil" [before]="profileText(agent().profile)" [after]="profileText(merged(s))" />
              }
              @if (s.proposal.systemPrompt === undefined && !s.proposal.profile) { <p class="muted small m0">La sugerencia no propone cambios.</p> }
              @if (canEdit()) {
                <div class="row wrap"><span class="spacer"></span>
                  <button class="btn sm" [disabled]="busy() === s.id" (click)="reject(s)"><nx-icon name="x" [size]="14" />Rechazar</button>
                  <button class="btn sm primary" [disabled]="busy() === s.id" (click)="apply(s)"><nx-icon name="check" [size]="14" />{{ busy() === s.id ? 'Aplicando…' : 'Aplicar' }}</button>
                </div>
              }
            } @else {
              <details>
                <summary class="small">Ver propuesta</summary>
                @if (s.proposal.systemPrompt !== undefined) { <pre class="code-block">{{ s.proposal.systemPrompt }}</pre> }
                @if (s.proposal.profile) { <pre class="code-block">{{ profileText(s.proposal.profile) }}</pre> }
              </details>
            }
          </article>
        } @empty {
          <div class="card empty"><nx-icon name="sparkles" [size]="32" /><h3>Sin sugerencias</h3>
            <p>Ejecute una evaluación y, en su detalle, pulse «Sugerir mejoras con IA».</p></div>
        }
      }
    </div>
  `,
  styles: `
    .m0 { margin: 0; }
    .grow { flex: 1; min-width: 200px; }
    .sug.pending { border-color: var(--primary); }
    .rationale p { margin: 4px 0 0; white-space: pre-wrap; word-break: break-word; }
    .tag { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--info); }
    details pre { margin-top: 8px; }
  `,
})
export class TrainingSuggestionsComponent implements OnInit {
  private readonly training = inject(TrainingApi);
  private readonly toast = inject(ToastService);
  readonly agent = input.required<Agent>();
  readonly canEdit = input(false);
  /** Hay cambios sin guardar en el formulario del agente (se perderían al aplicar). */
  readonly dirty = input(false);
  readonly applied = output<void>();
  readonly reevaluate = output<void>();

  readonly items = signal<PromptSuggestion[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal<string | null>(null);
  readonly justApplied = signal(false);

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const list = await this.training.suggestions(this.agent().id);
      // Pendientes primero; luego por fecha descendente.
      this.items.set(
        [...list].sort((a, b) => Number(b.status === 'PENDING') - Number(a.status === 'PENDING') || b.createdAt.localeCompare(a.createdAt)),
      );
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  status(s: PromptSuggestion) {
    return STATUS[s.status] ?? { cls: '', label: s.status };
  }

  profileText = profileToText;

  /** El perfil propuesto puede ser parcial: se combina con el actual para comparar. */
  merged(s: PromptSuggestion) {
    return { ...(this.agent().profile ?? {}), ...(s.proposal.profile ?? {}) };
  }

  async apply(s: PromptSuggestion) {
    const msg = this.dirty()
      ? '¿Aplicar esta sugerencia? Hay cambios sin guardar en el agente que se descartarán. Se guardará una versión previa.'
      : '¿Aplicar esta sugerencia al agente? Se guardará una versión previa para poder volver atrás.';
    if (!confirm(msg)) return;
    this.busy.set(s.id);
    try {
      await this.training.applySuggestion(s.id);
      this.items.update((l) => l.map((x) => (x.id === s.id ? { ...x, status: 'APPLIED' } : x)));
      this.justApplied.set(true);
      this.toast.success('Sugerencia aplicada');
      this.applied.emit();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  async reject(s: PromptSuggestion) {
    if (!confirm('¿Rechazar esta sugerencia?')) return;
    this.busy.set(s.id);
    try {
      await this.training.rejectSuggestion(s.id);
      this.items.update((l) => l.map((x) => (x.id === s.id ? { ...x, status: 'REJECTED' } : x)));
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }
}
