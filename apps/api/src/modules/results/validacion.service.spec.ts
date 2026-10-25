import { BadRequestException } from '@nestjs/common';
import { AgentVerificationService } from '../agents/agent-verification.service';
import { ValidacionService } from './validacion.service';

/** Contrato en PENDIENTE_VALIDACION con un agente ejecutor y un dueño humano ejecutor. */
function contrato(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    workspaceId: 'w1',
    estado: 'PENDIENTE_VALIDACION',
    responsableAgentId: 'agente-ejecutor',
    duenoUserId: 'dueno-ejecutor',
    tipoResultado: 'RESULTADO_NEGOCIO',
    version: 1,
    entradas: {},
    indicador: null,
    resultadoEsperado: 'x',
    reglaValidacion: { rules: [{ left: '{{ ok }}', operator: 'eq', right: true }] },
    evidenciaExigida: [],
    tarea: { responsableAgentId: 'agente-ejecutor', duenoUserId: 'dueno-ejecutor', criterioAceptacion: null },
    evidencias: [],
    ...overrides,
  };
}

function build(contratoRow: Record<string, unknown> | null) {
  const created: unknown[] = [];
  const prisma = {
    contratoResultado: {
      findFirst: jest.fn().mockResolvedValue(contratoRow),
      update: jest.fn((args: unknown) => args),
    },
    validacionResultado: {
      create: jest.fn((args: { data: unknown }) => {
        created.push(args.data);
        return args.data;
      }),
    },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };
  const service = new ValidacionService(prisma as never, new AgentVerificationService());
  return { service, prisma, created };
}

describe('ValidacionService (RF30: verificador ≠ ejecutor; aceptar solo con verificación superada)', () => {
  it('rechaza que el agente ejecutor valide su propio resultado (modo asistido)', async () => {
    const { service } = build(contrato());
    await expect(
      service.validar('w1', 'c1', {
        modo: 'ASISTIDA',
        verificadorAgentId: 'agente-ejecutor',
        critica: 'VEREDICTO: OK',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza que el dueño ejecutor valide su propio resultado (modo humano)', async () => {
    const { service } = build(contrato());
    await expect(
      service.validar('w1', 'c1', { modo: 'HUMANA', validadorUserId: 'dueno-ejecutor', veredicto: 'ACEPTA' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('acepta con un verificador humano distinto y deja el resultado ACEPTADO', async () => {
    const { service } = build(contrato());
    const res = await service.validar('w1', 'c1', {
      modo: 'HUMANA',
      validadorUserId: 'otra-persona',
      veredicto: 'ACEPTA',
    });
    expect(res.estadoResultado).toBe('ACEPTADO');
  });

  it('determinista acepta cuando la regla se cumple', async () => {
    const { service } = build(contrato({ tipoResultado: 'PRODUCTO_INTERMEDIO' }));
    const res = await service.validar('w1', 'c1', { modo: 'DETERMINISTA', contexto: { ok: true } });
    expect(res.estadoResultado).toBe('ACEPTADO');
  });

  it('determinista devuelve (DEVUELTO_INCUMPLIDO) cuando la regla no se cumple', async () => {
    const { service } = build(contrato({ tipoResultado: 'PRODUCTO_INTERMEDIO' }));
    const res = await service.validar('w1', 'c1', { modo: 'DETERMINISTA', contexto: { ok: false } });
    expect(res.estadoResultado).toBe('DEVUELTO_INCUMPLIDO');
  });

  it('asistida con verificador distinto y veredicto OK sobre resultado de negocio exige revisión humana (no autoacepta)', async () => {
    const { service } = build(contrato());
    const res = await service.validar('w1', 'c1', {
      modo: 'ASISTIDA',
      verificadorAgentId: 'otro-agente',
      critica: 'VEREDICTO: OK',
    });
    expect(res.estadoResultado).toBe('PENDIENTE_VALIDACION');
    expect(res.requiereRevisionHumana).toBe(true);
  });

  it('no valida si el resultado no está en PENDIENTE_VALIDACION', async () => {
    const { service } = build(contrato({ estado: 'EN_PRODUCCION' }));
    await expect(
      service.validar('w1', 'c1', { modo: 'HUMANA', validadorUserId: 'otra-persona', veredicto: 'ACEPTA' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
