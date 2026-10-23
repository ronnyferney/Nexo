import { Pipe, PipeTransform } from '@angular/core';

const USD = new Intl.NumberFormat('es', { style: 'currency', currency: 'USD' });
const USD_PRECISE = new Intl.NumberFormat('es', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
const NUM = new Intl.NumberFormat('es');

/**
 * Formatea montos en USD.
 * - `'auto'` (por defecto): 4 decimales para montos menores a 1 USD distintos de 0; 2 decimales en el resto.
 * - `'precise'`: siempre 4 decimales. `'standard'`: siempre 2 decimales.
 */
export function formatUsd(value: number | null | undefined, mode: 'auto' | 'precise' | 'standard' = 'auto'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const precise = mode === 'precise' || (mode === 'auto' && value !== 0 && Math.abs(value) < 1);
  return (precise ? USD_PRECISE : USD).format(value);
}

@Pipe({ name: 'usd' })
export class UsdPipe implements PipeTransform {
  transform(value: number | null | undefined, mode: 'auto' | 'precise' | 'standard' = 'auto'): string {
    return formatUsd(value, mode);
  }
}

/** Números con separadores de miles en español (tokens, llamadas). */
@Pipe({ name: 'num' })
export class NumberPipe implements PipeTransform {
  transform(value: number | null | undefined, maxFractionDigits?: number): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return maxFractionDigits === undefined
      ? NUM.format(value)
      : new Intl.NumberFormat('es', { maximumFractionDigits: maxFractionDigits }).format(value);
  }
}
