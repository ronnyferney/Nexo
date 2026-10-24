import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Estado de carga reutilizable: spinner accesible con texto opcional.
 * Anuncia el progreso a lectores de pantalla (`role="status"`, `aria-live="polite"`, `aria-busy`).
 * El spinner respeta `prefers-reduced-motion` (clase `.spinner` de `styles.scss`).
 *
 * Ejemplo:
 *   <nx-loading-state text="Cargando conectores…" />
 */
@Component({
  selector: 'nx-loading-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="empty" role="status" aria-live="polite" aria-busy="true">
      <span class="spinner" [class.lg]="size() === 'lg'" [class.sm]="size() === 'sm'" aria-hidden="true"></span>
      @if (text()) {
        <p>{{ text() }}</p>
      }
      <span class="sr-only">{{ text() || 'Cargando' }}</span>
    </div>
  `,
})
export class LoadingStateComponent {
  /** Texto visible bajo el spinner. Vacío para mostrar solo el spinner. */
  readonly text = input('Cargando…');
  /** Tamaño del spinner. */
  readonly size = input<'sm' | 'md' | 'lg'>('md');
}
