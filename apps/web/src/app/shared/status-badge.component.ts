import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const MAP: Record<string, { cls: string; label: string }> = {
  QUEUED: { cls: 'info', label: 'En cola' },
  RUNNING: { cls: 'primary', label: 'Ejecutando' },
  SUCCEEDED: { cls: 'success', label: 'Exitosa' },
  FAILED: { cls: 'danger', label: 'Fallida' },
  CANCELLED: { cls: '', label: 'Cancelada' },
  running: { cls: 'primary', label: 'Ejecutando' },
  succeeded: { cls: 'success', label: 'OK' },
  failed: { cls: 'danger', label: 'Error' },
  skipped: { cls: '', label: 'Omitido' },
};

@Component({
  selector: 'nx-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge {{ meta().cls }}"><span class="dot"></span>{{ meta().label }}</span>`,
})
export class StatusBadgeComponent {
  readonly status = input.required<string>();
  readonly meta = computed(() => MAP[this.status()] ?? { cls: '', label: this.status() });
}
