import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/** Vigencia por defecto de una clave de idempotencia: 24 h. Pasada, una repetición muy posterior puede re-ejecutarse. */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface WithIdempotencyOptions {
  /** Vigencia de la clave en milisegundos (por defecto 24 h). */
  ttlMs?: number;
  /** Datos de entrada cuyo hash se guarda para detectar colisiones de clave con contenido distinto. */
  contenido?: unknown;
}

export interface IdempotencyOutcome<T> {
  /** Resultado del efecto (recién ejecutado o recuperado de una ejecución previa). */
  resultado: T;
  /** `true` si se devolvió un resultado previo SIN re-ejecutar el efecto (QA04). */
  reusado: boolean;
}

const EXPIRED = (expiresAt: Date | null, now: Date) => expiresAt != null && expiresAt.getTime() <= now.getTime();

/**
 * Idempotencia por operación de negocio (E7 · RF17/RF20). `withIdempotency(clave, fn)` garantiza que el efecto `fn`
 * se ejecuta UNA sola vez por `(workspaceId, clave)` vigente: ante una repetición (redelivery / reejecución) devuelve
 * el resultado previo sin volver a ejecutar (QA04). La reutiliza el `ActionGateway` en su punto de despacho para que un
 * reintento o reentrega no duplique el efecto de negocio. NO promete exactly-once sobre el sistema externo: solo evita
 * que ESTA plataforma lance dos veces el mismo efecto; la incertidumbre externa la trata la conciliación (RF20).
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  private hash(contenido: unknown): string | null {
    if (contenido === undefined) return null;
    return createHash('sha256')
      .update(JSON.stringify(contenido ?? null))
      .digest('hex');
  }

  /**
   * Ejecuta `fn` bajo la clave de idempotencia. Semántica:
   * - Si existe una clave COMPLETADA y vigente → devuelve su `resultado` y NO ejecuta `fn` (reusado = true).
   * - Si existe EN_PROGRESO y vigente → otra ejecución está en curso: lanza `ConflictException` (no duplica el efecto).
   * - Si existe FALLIDA o caducada, o no existe → reclama la clave (EN_PROGRESO) y ejecuta `fn`; al terminar la marca
   *   COMPLETADA con el resultado, o FALLIDA si `fn` lanzó (y re-lanza el error para que el llamador lo gestione).
   */
  async withIdempotency<T>(
    workspaceId: string,
    clave: string,
    scope: string,
    fn: () => Promise<T>,
    opts: WithIdempotencyOptions = {},
  ): Promise<IdempotencyOutcome<T>> {
    const now = new Date();
    const hash = this.hash(opts.contenido);
    const expiresAt = new Date(now.getTime() + (opts.ttlMs ?? DEFAULT_TTL_MS));

    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { workspaceId_clave: { workspaceId, clave } },
    });
    if (existing && !EXPIRED(existing.expiresAt, now)) {
      if (existing.estado === 'COMPLETADA') {
        return { resultado: existing.resultado as T, reusado: true };
      }
      if (existing.estado === 'EN_PROGRESO') {
        throw new ConflictException(`Operación en curso para la clave de idempotencia (scope ${scope})`);
      }
      // FALLIDA vigente: se permite reintentar reclamando de nuevo la clave (abajo).
    }

    // Reclama la clave de forma atómica: si otro proceso la creó justo ahora, el unique dispara P2002 → la recuperamos.
    try {
      await this.prisma.idempotencyKey.upsert({
        where: { workspaceId_clave: { workspaceId, clave } },
        create: { workspaceId, clave, scope, estado: 'EN_PROGRESO', hash, expiresAt },
        update: { estado: 'EN_PROGRESO', scope, hash, expiresAt, resultado: Prisma.JsonNull },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const concurrent = await this.prisma.idempotencyKey.findUnique({
          where: { workspaceId_clave: { workspaceId, clave } },
        });
        if (concurrent?.estado === 'COMPLETADA') return { resultado: concurrent.resultado as T, reusado: true };
        throw new ConflictException(`Operación en curso para la clave de idempotencia (scope ${scope})`);
      }
      throw err;
    }

    try {
      const resultado = await fn();
      await this.prisma.idempotencyKey.update({
        where: { workspaceId_clave: { workspaceId, clave } },
        data: { estado: 'COMPLETADA', resultado: (resultado ?? null) as Prisma.InputJsonValue },
      });
      return { resultado, reusado: false };
    } catch (err) {
      await this.prisma.idempotencyKey
        .update({ where: { workspaceId_clave: { workspaceId, clave } }, data: { estado: 'FALLIDA' } })
        .catch(() => undefined);
      throw err;
    }
  }

  /** Consulta el estado de una clave (para conciliación / bandeja de excepciones). */
  find(workspaceId: string, clave: string) {
    return this.prisma.idempotencyKey.findUnique({ where: { workspaceId_clave: { workspaceId, clave } } });
  }
}
