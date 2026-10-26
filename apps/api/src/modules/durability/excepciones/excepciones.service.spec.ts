import { BadRequestException } from '@nestjs/common';
import { ExcepcionesService } from './excepciones.service';

/** Prisma en memoria mínimo para Excepcion + ExcepcionEvento + IdempotencyKey. */
function build(opts: { excepcion?: Record<string, unknown>; idempotencyKey?: Record<string, unknown> } = {}) {
  const eventos: Record<string, unknown>[] = [];
  let excepcion: Record<string, unknown> | null = opts.excepcion ?? null;
  const prisma = {
    excepcion: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        excepcion = { id: 'exc-1', eventos: [], ...data };
        return excepcion;
      }),
      findFirst: jest.fn(() => excepcion),
      findMany: jest.fn(() => (excepcion ? [excepcion] : [])),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        excepcion = { ...(excepcion as object), ...data };
        return excepcion;
      }),
    },
    excepcionEvento: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        eventos.push(data);
        return data;
      }),
      findMany: jest.fn(() => eventos),
    },
    idempotencyKey: {
      findFirst: jest.fn(() => opts.idempotencyKey ?? null),
    },
  };
  const service = new ExcepcionesService(prisma as never);
  return { service, prisma, eventos };
}

describe('ExcepcionesService (RF21)', () => {
  it('reintentar con una acción YA confirmada (idempotencia COMPLETADA) NO duplica el efecto y conserva historial (QA06)', async () => {
    const { service, eventos } = build({
      excepcion: { id: 'exc-1', workspaceId: 'w1', estado: 'ABIERTA', idempotencyKeyId: 'idem-1', evidencia: {} },
      idempotencyKey: { id: 'idem-1', workspaceId: 'w1', estado: 'COMPLETADA', resultado: { ok: true } },
    });

    const res = (await service.reintentar('w1', 'exc-1', 'user-1')) as { estado: string; siguienteAccion: string };

    // No se re-ejecuta: la excepción se concilia porque el efecto ya está confirmado.
    expect(res.estado).toBe('CONCILIADA');
    expect(res.siguienteAccion).toContain('ya confirmada');
    // El historial se conserva (se AÑADE un evento de reintento, no se borra nada).
    const reintentos = eventos.filter((e) => e.tipo === 'REINTENTO');
    expect(reintentos).toHaveLength(1);
    expect((reintentos[0].detalle as { yaConfirmada: boolean }).yaConfirmada).toBe(true);
  });

  it('reintentar sin acción confirmada deja EN_PROGRESO (reintento protegido por idempotencia)', async () => {
    const { service } = build({
      excepcion: { id: 'exc-1', workspaceId: 'w1', estado: 'ABIERTA', idempotencyKeyId: null, evidencia: {} },
    });
    const res = (await service.reintentar('w1', 'exc-1', 'user-1')) as { estado: string };
    expect(res.estado).toBe('EN_PROGRESO');
  });

  it('no permite acciones sobre una excepción cerrada', async () => {
    const { service } = build({ excepcion: { id: 'exc-1', workspaceId: 'w1', estado: 'CANCELADA', evidencia: {} } });
    await expect(service.reintentar('w1', 'exc-1', 'u')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.reasignar('w1', 'exc-1', { duenoUserId: 'x' }, 'u')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('reasignar cambia el dueño y registra el evento', async () => {
    const { service, eventos } = build({
      excepcion: { id: 'exc-1', workspaceId: 'w1', estado: 'ABIERTA', duenoUserId: 'old', evidencia: {} },
    });
    const res = (await service.reasignar('w1', 'exc-1', { duenoUserId: 'nuevo', motivo: 'carga' }, 'u')) as {
      duenoUserId: string;
    };
    expect(res.duenoUserId).toBe('nuevo');
    expect(eventos.some((e) => e.tipo === 'REASIGNACION')).toBe(true);
  });

  it('conciliar CONFIRMADO cierra como CONCILIADA; NO_OCURRIO deja EN_PROGRESO para reintento seguro', async () => {
    const a = build({ excepcion: { id: 'exc-1', workspaceId: 'w1', estado: 'ABIERTA', evidencia: {} } });
    const r1 = (await a.service.conciliar('w1', 'exc-1', { resultado: 'CONFIRMADO' }, 'u')) as { estado: string };
    expect(r1.estado).toBe('CONCILIADA');

    const b = build({ excepcion: { id: 'exc-1', workspaceId: 'w1', estado: 'ABIERTA', evidencia: {} } });
    const r2 = (await b.service.conciliar('w1', 'exc-1', { resultado: 'NO_OCURRIO' }, 'u')) as { estado: string };
    expect(r2.estado).toBe('EN_PROGRESO');
  });
});
