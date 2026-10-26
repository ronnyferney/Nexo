import { componerDocumento, hashRef, type PasaporteComposerInput } from './pasaporte.composer';

/**
 * Composición del cuerpo canónico del pasaporte (ADR 0014 · E14). Spec viva del hashing determinista: el mismo estado
 * referenciado produce SIEMPRE el mismo `documentHash` (reproducible por un tercero), el orden de lectura no influye, y
 * cambiar cualquier referencia cambia el hash. No toca Prisma: es una función pura.
 */
describe('pasaporte.composer', () => {
  function base(): PasaporteComposerInput {
    return {
      contrato: {
        id: 'c1',
        version: 1,
        estado: 'ACEPTADO',
        tipoResultado: 'RESULTADO_NEGOCIO',
        nivelRiesgo: 2,
        resultadoEsperado: 'Recaudo confirmado',
        indicador: null,
        responsableAgentId: 'ag-ejecutor',
        duenoUserId: 'u1',
        comprometidoAt: '2026-01-01T00:00:00.000Z',
      },
      tarea: {
        id: 't1',
        titulo: 'Confirmar recaudo',
        estado: 'EN_EJECUCION',
        responsableAgentId: 'ag-ejecutor',
        duenoUserId: 'u1',
        criterioAceptacion: 'Confirmado por Tesorería',
      },
      agentes: [{ agentId: 'ag-ejecutor', roles: ['ejecutor'], responsableUserId: 'u9', agentVersionId: 'v1' }],
      transferencias: [],
      mensajes: [],
      ejecuciones: [
        {
          id: 'e1',
          status: 'SUCCEEDED',
          workflowId: 'wf1',
          secuenciaSegmento: null,
          finishedAt: '2026-01-02T00:00:00.000Z',
        },
        {
          id: 'e2',
          status: 'SUCCEEDED',
          workflowId: 'wf1',
          secuenciaSegmento: null,
          finishedAt: '2026-01-03T00:00:00.000Z',
        },
      ],
      conectores: [],
      aprobaciones: [],
      validaciones: [
        {
          id: 'val1',
          modo: 'DETERMINISTA',
          veredicto: 'ACEPTA',
          verificadorAgentId: 'ag-verificador',
          validadorUserId: null,
          motivo: 'REGLA_DETERMINISTA_CUMPLE',
          version: 1,
          createdAt: '2026-01-02T12:00:00.000Z',
        },
      ],
      usageRecords: [
        {
          id: 'ur1',
          executionId: 'e1',
          model: 'mock-echo',
          providerId: 'mock',
          costUsd: '0.00010000',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
        {
          id: 'ur2',
          executionId: 'e2',
          model: 'mock-echo',
          providerId: 'mock',
          costUsd: '0.00025000',
          createdAt: '2026-01-03T00:00:00.000Z',
        },
      ],
      auditSeqs: [3, 1, 2],
    };
  }

  it('produce un documentHash determinista (reproducible con el mismo estado)', () => {
    const a = componerDocumento(base());
    const b = componerDocumento(base());
    expect(a.documentHash).toBe(b.documentHash);
    expect(a.documentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('es invariante al orden de lectura de las colecciones', () => {
    const original = base();
    const a = componerDocumento(original);

    const desordenado = base();
    desordenado.ejecuciones = [...original.ejecuciones].reverse();
    desordenado.usageRecords = [...original.usageRecords].reverse();
    desordenado.auditSeqs = [1, 2, 3];
    const b = componerDocumento(desordenado);

    expect(b.documentHash).toBe(a.documentHash);
    expect(b.documentoRef.auditSeqs).toEqual([1, 2, 3]);
  });

  it('cambia el hash si cambia una referencia (veredicto de una validación)', () => {
    const a = componerDocumento(base());
    const mutado = base();
    mutado.validaciones[0].veredicto = 'DEVUELVE';
    const b = componerDocumento(mutado);
    expect(b.documentHash).not.toBe(a.documentHash);
  });

  it('agrega el costo total imputado con precisión decimal exacta', () => {
    const { documentoRef } = componerDocumento(base());
    expect(documentoRef.totales.costoTotalUsd).toBe('0.00035000');
    expect(documentoRef.totales.numEjecuciones).toBe(2);
    expect(documentoRef.totales.numValidaciones).toBe(1);
    expect(documentoRef.totales.numUsageRecords).toBe(2);
  });

  it('nunca copia datos sensibles: solo guarda id + hash por referencia', () => {
    const { documentoRef } = componerDocumento(base());
    expect(documentoRef.ejecuciones.map((r) => r.id)).toEqual(['e1', 'e2']);
    for (const ref of documentoRef.ejecuciones) {
      expect(Object.keys(ref).sort()).toEqual(['hash', 'id']);
      expect(ref.hash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(documentoRef.conectores).toEqual([]);
  });

  it('hashRef es estable e independiente del orden de las claves', () => {
    expect(hashRef({ a: 1, b: 2 })).toBe(hashRef({ b: 2, a: 1 }));
    expect(hashRef({ a: 1 })).not.toBe(hashRef({ a: 2 }));
  });
});
