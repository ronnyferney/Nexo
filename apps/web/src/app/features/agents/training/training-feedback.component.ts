import { ChangeDetectionStrategy, Component, inject, input, OnInit, output, signal } from '@angular/core';
import { errorMessage } from '../../../core/api.service';
import { TrainingApi } from '../../../core/training.api';
import type { Feedback } from '../../../core/training.models';
import { IconComponent } from '../../../shared/icon.component';
import { FeedbackReviewItemComponent } from './feedback-review-item.component';

/** Paso «Supervisar»: retroalimentación pendiente del agente. */
@Component({
  selector: 'nx-training-feedback',
  imports: [IconComponent, FeedbackReviewItemComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      <div class="row wrap">
        <p class="muted small m0 grow">Las respuestas calificadas con 👎 o corregidas en el chat llegan aquí. Al aprobar una corrección se crea un ejemplo de entrenamiento y, si lo indica, un caso de evaluación.</p>
        <button class="btn sm" [disabled]="loading()" (click)="load()"><nx-icon name="refresh" [size]="14" />Actualizar</button>
      </div>
      @if (loading() && !items().length) {
        <div class="card empty"><p>Cargando retroalimentación…</p></div>
      } @else if (error()) {
        <div class="card empty"><nx-icon name="alert" [size]="28" /><h3>No se pudo cargar la retroalimentación</h3><p>{{ error() }}</p>
          <button class="btn" (click)="load()">Reintentar</button></div>
      } @else {
        @for (fb of items(); track fb.id) {
          <nx-feedback-review-item [feedback]="fb" [canEdit]="canEdit()" (reviewed)="onReviewed(fb.id)" />
        } @empty {
          <div class="card empty"><nx-icon name="checkCircle" [size]="32" /><h3>Nada pendiente</h3>
            <p>Califique respuestas en el panel «Probar agente» con 👍 / 👎 o «Corregir» para alimentar el ciclo.</p></div>
        }
      }
    </div>
  `,
  styles: [`.m0 { margin: 0; } .grow { flex: 1; min-width: 220px; }`],
})
export class TrainingFeedbackComponent implements OnInit {
  private readonly training = inject(TrainingApi);
  readonly agentId = input.required<string>();
  readonly canEdit = input(false);
  readonly changed = output<void>();
  readonly items = signal<Feedback[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.items.set(await this.training.agentFeedback(this.agentId(), 'PENDING'));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  onReviewed(id: string) {
    this.items.update((l) => l.filter((x) => x.id !== id));
    this.changed.emit();
  }
}
