import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from './icon.component';

/**
 * Estado vacío reutilizable: ícono (con el acento de marca de `.empty`), título, descripción opcional
 * y una acción opcional. Para acciones a medida (enlaces, varios botones) proyecta contenido con
 * `.empty-actions` mediante `<ng-content>`.
 *
 * Ejemplo:
 *   <nx-empty-state icon="plug" title="Sin conectores"
 *     description="Crea tu primer conector para empezar." actionLabel="Nuevo conector"
 *     actionIcon="plus" (action)="crear()" />
 */
@Component({
  selector: 'nx-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="empty">
      <nx-icon [name]="icon()" [size]="36" />
      <h3>{{ title() }}</h3>
      @if (description()) {
        <p>{{ description() }}</p>
      }
      @if (actionLabel()) {
        <div class="empty-actions">
          <button type="button" class="btn primary" (click)="action.emit()">
            @if (actionIcon()) {
              <nx-icon [name]="actionIcon()" [size]="16" />
            }
            {{ actionLabel() }}
          </button>
        </div>
      }
      <ng-content />
    </div>
  `,
})
export class EmptyStateComponent {
  /** Nombre del ícono (mapa de `nx-icon`). Por defecto una bandeja vacía. */
  readonly icon = input('inbox');
  readonly title = input.required<string>();
  /** Texto descriptivo opcional. */
  readonly description = input('');
  /** Si se indica, se muestra un botón primario con este texto. */
  readonly actionLabel = input('');
  /** Ícono opcional del botón de acción. */
  readonly actionIcon = input('');
  /** Se emite al pulsar el botón de acción. */
  readonly action = output<void>();
}
