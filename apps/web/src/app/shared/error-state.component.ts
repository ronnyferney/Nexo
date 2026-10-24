import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from './icon.component';

/**
 * Estado de error reutilizable: ícono de alerta (conserva la semántica roja), título, mensaje y
 * botón «Reintentar» opcional. Usa `role="alert"` para anunciar el error a lectores de pantalla.
 *
 * Ejemplo:
 *   <nx-error-state message="No se pudo cargar el catálogo." (retry)="load()" />
 */
@Component({
  selector: 'nx-error-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="empty" role="alert">
      <nx-icon name="alert" [size]="32" />
      <h3>{{ title() }}</h3>
      @if (message()) {
        <p class="error-text">{{ message() }}</p>
      }
      @if (retryable()) {
        <div class="empty-actions">
          <button type="button" class="btn" (click)="retry.emit()">
            <nx-icon name="refresh" [size]="16" />
            {{ retryLabel() }}
          </button>
        </div>
      }
      <ng-content />
    </div>
  `,
})
export class ErrorStateComponent {
  /** Título del error. */
  readonly title = input('No se pudo cargar');
  /** Mensaje descriptivo del error. */
  readonly message = input('');
  /** Texto del botón de reintento. */
  readonly retryLabel = input('Reintentar');
  /** Muestra el botón de reintento (true por defecto). */
  readonly retryable = input(true);
  /** Se emite al pulsar «Reintentar». */
  readonly retry = output<void>();
}
