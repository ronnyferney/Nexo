import { Pipe, PipeTransform } from '@angular/core';

const PCT = new Intl.NumberFormat('es', { style: 'percent', maximumFractionDigits: 0 });

/** Puntaje de calidad 0–1 como porcentaje (`0.82` → `82 %`); `—` si no hay puntaje. */
export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return PCT.format(value);
}

@Pipe({ name: 'score' })
export class ScorePipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatScore(value);
  }
}
