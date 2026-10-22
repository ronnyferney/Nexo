import { Pipe, PipeTransform } from '@angular/core';

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

@Pipe({ name: 'ago' })
export class RelativeTimePipe implements PipeTransform {
  transform(value: string | Date | null | undefined): string {
    if (!value) return '—';
    const diff = (new Date(value).getTime() - Date.now()) / 1000;
    const abs = Math.abs(diff);
    if (abs < 60) return rtf.format(Math.round(diff), 'second');
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    return rtf.format(Math.round(diff / 86400), 'day');
  }
}

@Pipe({ name: 'duration' })
export class DurationPipe implements PipeTransform {
  transform(start?: string | null, end?: string | null): string {
    if (!start || !end) return '—';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
  }
}
