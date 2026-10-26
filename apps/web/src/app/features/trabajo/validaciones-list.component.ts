import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import type { ValidacionResultado } from '../../core/results.models';
import { MODO_VALIDACION_LABEL, VEREDICTO_META } from './trabajo.util';

/**
 * Historial de verificaciones (RF30). Deja explícito QUIÉN verificó (verificador ≠ ejecutor), el modo, el veredicto
 * (acepta/devuelve) y el motivo auditable. Una devolución conserva versión y motivo (HU14).
 */
@Component({
  selector: 'nx-validaciones-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RelativeTimePipe, EmptyStateComponent],
  template: `
    @if (validaciones().length) {
      <ul class="val">
        @for (v of validaciones(); track v.id) {
          <li>
            <span class="badge {{ veredicto(v).badge }}">{{ veredicto(v).label }}</span>
            <div class="body">
              <div class="line">
                <strong>{{ modo(v) }}</strong>
                <span class="muted">· versión {{ v.version }} · {{ v.createdAt | ago }}</span>
              </div>
              <div class="who">
                @if (v.verificadorAgentId) {
                  <span title="Agente verificador (distinto del ejecutor)">Verificó agente {{ corto(v.verificadorAgentId) }}</span>
                } @else if (v.validadorUserId) {
                  <span title="Persona validadora (distinta del dueño ejecutor)">Validó persona {{ corto(v.validadorUserId) }}</span>
                } @else {
                  <span class="muted">Verificación automática</span>
                }
              </div>
              @if (v.motivo) {
                <p class="motivo">{{ v.motivo }}</p>
              }
            </div>
          </li>
        }
      </ul>
    } @else {
      <nx-empty-state
        icon="shield"
        title="Sin verificaciones"
        description="El resultado aún no ha sido verificado por nadie distinto del ejecutor." />
    }
  `,
  styles: `
    .val { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
    .val li { display: flex; gap: 10px; align-items: flex-start; }
    .body { min-width: 0; flex: 1; }
    .line { font-size: 13.5px; }
    .muted { color: var(--muted); font-weight: 400; }
    .who { font-size: 12.5px; color: var(--muted); margin-top: 2px; }
    .motivo { margin: 6px 0 0; font-size: 13px; font-family: ui-monospace, monospace; background: var(--surface-2); padding: 6px 9px; border-radius: 8px; word-break: break-word; }
  `,
})
export class ValidacionesListComponent {
  readonly validaciones = input.required<ValidacionResultado[]>();
  protected modo(v: ValidacionResultado): string {
    return MODO_VALIDACION_LABEL[v.modo];
  }
  protected veredicto(v: ValidacionResultado) {
    return VEREDICTO_META[v.veredicto];
  }
  /** Muestra solo un sufijo corto de un id blando (no hay resolución de nombres en este contrato). */
  protected corto(id: string): string {
    return `…${id.slice(-6)}`;
  }
}
