import type { CatalogModel, ProviderInfo } from '../../../core/models';
import type { AgentProfile } from '../../../core/studio.models';
import type { TrainingSummary } from '../../../core/training.models';

/** Clave `"<providerId>:<modelId>"` de un modelo del catálogo. */
export function modelKey(providerId: string, modelId: string) {
  return `${providerId}:${modelId}`;
}

/** Separa una clave de modelo; el id del modelo puede contener `:`. */
export function parseModelKey(key: string): { providerId: string; model: string } | null {
  const i = key.indexOf(':');
  return i > 0 ? { providerId: key.slice(0, i), model: key.slice(i + 1) } : null;
}

/** Modelo sugerido para juez o sugerencias: el primer PREMIUM configurado, si no el primero disponible. */
export function defaultModelKey(providers: ProviderInfo[]): string {
  const configured = providers.filter((p) => p.configured && p.models.length);
  for (const p of configured) {
    const m = p.models.find((x: CatalogModel) => x.tier === 'PREMIUM');
    if (m) return modelKey(p.id, m.id);
  }
  const first = configured[0];
  return first ? modelKey(first.id, first.models[0]!.id) : '';
}

const SECTIONS: [keyof AgentProfile, string][] = [
  ['role', 'Rol'],
  ['goals', 'Objetivos'],
  ['responsibilities', 'Responsabilidades'],
  ['boundaries', 'Límites'],
  ['tone', 'Tono'],
  ['outputFormat', 'Formato de salida'],
  ['language', 'Idioma'],
];

/** Representación en texto del perfil, línea por línea, para compararlo en un diff. */
export function profileToText(profile: Partial<AgentProfile> | null | undefined): string {
  const lines: string[] = [];
  for (const [key, label] of SECTIONS) {
    const v = profile?.[key];
    if (Array.isArray(v)) {
      const items = v.map((x) => String(x).trim()).filter(Boolean);
      if (!items.length) continue;
      lines.push(`${label}:`, ...items.map((x) => `  - ${x}`));
    } else if (typeof v === 'string' && v.trim()) {
      lines.push(`${label}: ${v.trim()}`);
    }
  }
  return lines.join('\n');
}

/** Etiqueta de versión `v3` a partir del número o del objeto que devuelva la API. */
export function versionLabel(v: TrainingSummary['bestVersion'] | number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const n = typeof v === 'number' ? v : v.version;
  return n === null || n === undefined ? '—' : `v${n}`;
}

const DATE_TIME = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });

export function formatDateTime(value: string | null | undefined): string {
  return value ? DATE_TIME.format(new Date(value)) : '—';
}

/** Código HTTP de un error de la API, o `null` si no lo tiene. */
export function httpStatus(err: unknown): number | null {
  const s = (err as { status?: unknown })?.status;
  return typeof s === 'number' ? s : null;
}
