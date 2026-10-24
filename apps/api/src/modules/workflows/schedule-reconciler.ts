import type { JobSchedulerJson } from 'bullmq';

/** Programador cron de un flujo o una rutina: dueño (id del flujo/rutina), patrón y zona horaria. */
export interface ScheduleEntry {
  ownerId: string;
  pattern: string;
  tz: string | null;
}

/**
 * Origen de programadores que se reconcilia contra Redis (P9). `desired` sale de PostgreSQL (fuente de verdad),
 * `registered` de los JobScheduler de BullMQ y `apply` reutiliza la función que ya registra (entry) o quita (null)
 * el programador en el servicio dueño, para no duplicar su lógica.
 */
export interface ScheduleSource {
  /** Nombre para el log (sin datos de clientes). */
  readonly kind: string;
  desired(): Promise<ScheduleEntry[]>;
  registered(): Promise<ScheduleEntry[]>;
  apply(ownerId: string, entry: ScheduleEntry | null): Promise<void>;
}

export interface ReconcileStats {
  created: number;
  updated: number;
  removed: number;
  failed: number;
}

/** Programadores BullMQ con el prefijo dado convertidos a entradas (el resto de la cola, p. ej. la retención, se ignora). */
export function schedulerEntries(schedulers: JobSchedulerJson[], prefix: string): ScheduleEntry[] {
  return schedulers
    .filter((s) => typeof s.key === 'string' && s.key.startsWith(prefix))
    .map((s) => ({ ownerId: s.key.slice(prefix.length), pattern: s.pattern ?? '', tz: s.tz ?? null }));
}

const differs = (a: ScheduleEntry, b: ScheduleEntry) => a.pattern !== b.pattern || (a.tz ?? null) !== (b.tz ?? null);

/**
 * Reconciliación idempotente de un origen: crea los programadores que faltan, actualiza los que difieren en patrón o
 * zona horaria y elimina los huérfanos (flujo/rutina inexistente, inactivo o sin schedule). Un fallo individual
 * (p. ej. un cron inválido guardado) no detiene el resto: se cuenta en `failed` e informa por `onError`.
 */
export async function reconcileSource(
  source: ScheduleSource,
  onError: (ownerId: string, err: unknown) => void = () => undefined,
): Promise<ReconcileStats> {
  const stats: ReconcileStats = { created: 0, updated: 0, removed: 0, failed: 0 };
  const [desired, registered] = await Promise.all([source.desired(), source.registered()]);
  const current = new Map(registered.map((e) => [e.ownerId, e]));
  const wanted = new Set<string>();

  const attempt = async (ownerId: string, entry: ScheduleEntry | null, counter: keyof ReconcileStats) => {
    try {
      await source.apply(ownerId, entry);
      stats[counter]++;
    } catch (err) {
      stats.failed++;
      onError(ownerId, err);
    }
  };

  for (const entry of desired) {
    if (!entry.pattern.trim() || wanted.has(entry.ownerId)) continue;
    wanted.add(entry.ownerId);
    const existing = current.get(entry.ownerId);
    if (!existing) await attempt(entry.ownerId, entry, 'created');
    else if (differs(existing, entry)) await attempt(entry.ownerId, entry, 'updated');
  }
  for (const existing of registered) {
    if (!wanted.has(existing.ownerId)) await attempt(existing.ownerId, null, 'removed');
  }
  return stats;
}
