import { ChangeDetectionStrategy, Component, computed, model, signal } from '@angular/core';

/** Rango de fechas inclusivo en formato `YYYY-MM-DD` (fecha local). */
export interface DateRange {
  from: string;
  to: string;
}

type Preset = '7d' | '30d' | '90d' | 'month' | 'custom';

const PRESETS: { id: Preset; label: string }[] = [
  { id: '7d', label: '7 días' },
  { id: '30d', label: '30 días' },
  { id: '90d', label: '90 días' },
  { id: 'month', label: 'Este mes' },
  { id: 'custom', label: 'Personalizado' },
];

export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Rango de los últimos `days` días, incluido hoy. */
export function lastDays(days: number, today = new Date()): DateRange {
  const from = new Date(today);
  from.setDate(from.getDate() - (days - 1));
  return { from: isoDay(from), to: isoDay(today) };
}

/** Convierte el rango local a instantes ISO para la API: `from` al inicio del día y `to` al final. */
export function rangeToIso(range: DateRange): { from: string; to: string } {
  return {
    from: new Date(`${range.from}T00:00:00`).toISOString(),
    to: new Date(`${range.to}T23:59:59.999`).toISOString(),
  };
}

function presetRange(p: Exclude<Preset, 'custom'>): DateRange {
  if (p === 'month') {
    const today = new Date();
    return { from: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDay(today) };
  }
  return lastDays(p === '7d' ? 7 : p === '30d' ? 30 : 90);
}

function sameRange(a: DateRange, b: DateRange): boolean {
  return a.from === b.from && a.to === b.to;
}

/** Selector de rango de fechas con atajos y rango personalizado. Enlace bidireccional: `[(range)]`. */
@Component({
  selector: 'nx-date-range',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row wrap" role="group" aria-label="Rango de fechas">
      <div class="segmented">
        @for (p of presets; track p.id) {
          <button type="button" [class.active]="preset() === p.id" [attr.aria-pressed]="preset() === p.id" (click)="choose(p.id)">{{ p.label }}</button>
        }
      </div>
      @if (preset() === 'custom') {
        <input class="input" type="date" aria-label="Desde" style="width:auto" [value]="range().from" [max]="range().to"
          (change)="setFrom($any($event.target).value)" />
        <span class="muted small">a</span>
        <input class="input" type="date" aria-label="Hasta" style="width:auto" [value]="range().to" [min]="range().from" [max]="today"
          (change)="setTo($any($event.target).value)" />
      }
      @if (invalid()) { <span class="error-text" role="alert">La fecha inicial debe ser anterior a la final.</span> }
    </div>
  `,
})
export class DateRangeComponent {
  readonly range = model<DateRange>(lastDays(30));
  /** Modo personalizado elegido explícitamente; si no, el atajo se deduce del rango (p. ej. al volver a la página). */
  private readonly custom = signal(false);
  readonly preset = computed<Preset>(() => {
    if (this.custom()) return 'custom';
    const r = this.range();
    const match = PRESETS.find((p) => p.id !== 'custom' && sameRange(presetRange(p.id), r));
    return match?.id ?? 'custom';
  });
  readonly presets = PRESETS;
  readonly today = isoDay(new Date());
  private readonly draft = signal<DateRange | null>(null);
  readonly invalid = computed(() => {
    const d = this.draft();
    return !!d && d.from > d.to;
  });

  choose(p: Preset) {
    this.custom.set(p === 'custom');
    this.draft.set(null);
    if (p !== 'custom') this.range.set(presetRange(p));
  }

  setFrom(from: string) {
    if (from) this.apply({ ...this.range(), from });
  }

  setTo(to: string) {
    if (to) this.apply({ ...this.range(), to });
  }

  private apply(r: DateRange) {
    this.draft.set(r);
    if (r.from <= r.to) this.range.set(r);
  }
}
