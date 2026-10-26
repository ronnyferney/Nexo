import type { DocumentoRef, PasaporteResultado } from '../../core/pasaporte.models';
import {
  accionPasaporte,
  autorPasaporte,
  claveAlmacen,
  conteosVista,
  formatCostoTotal,
  veredictoVista,
} from './pasaporte.util';

function docVacio(): DocumentoRef {
  return {
    contrato: { id: 'c1', version: 1, hash: 'h' },
    tarea: null,
    agentes: [],
    transferencias: [],
    mensajes: [],
    ejecuciones: [],
    conectores: [],
    aprobaciones: [],
    validaciones: [],
    usageRecords: [],
    auditSeqs: [],
    totales: {
      costoTotalUsd: '0.00000000',
      numEjecuciones: 0,
      numMensajes: 0,
      numTransferencias: 0,
      numAprobaciones: 0,
      numValidaciones: 0,
      numUsageRecords: 0,
    },
  };
}

function pasaporte(parcial: Partial<PasaporteResultado> = {}): PasaporteResultado {
  return {
    id: 'p1',
    workspaceId: 'w1',
    contratoResultadoId: 'c1',
    tareaId: 't1',
    documentoRef: docVacio(),
    documentHash: 'abc',
    auditSeq: 10,
    auditEntryId: 'a1',
    reemplazaAId: null,
    emitidoPorUserId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...parcial,
  };
}

describe('pasaporte.util', () => {
  describe('accionPasaporte', () => {
    it('no aplica si el resultado no está ACEPTADO (solo se emite de un resultado aceptado)', () => {
      expect(accionPasaporte('EN_PRODUCCION', null)).toBe('no-aplica');
      expect(accionPasaporte('PENDIENTE_VALIDACION', pasaporte())).toBe('no-aplica');
      expect(accionPasaporte(null, null)).toBe('no-aplica');
    });

    it('ofrece emitir si está ACEPTADO y no hay pasaporte conocido', () => {
      expect(accionPasaporte('ACEPTADO', null)).toBe('emitir');
      expect(accionPasaporte('ACEPTADO', undefined)).toBe('emitir');
    });

    it('ofrece ver si está ACEPTADO y ya hay un pasaporte emitido', () => {
      expect(accionPasaporte('ACEPTADO', pasaporte())).toBe('ver');
    });
  });

  describe('veredictoVista', () => {
    it('marca íntegro cuando ok es verdadero', () => {
      const v = veredictoVista(true);
      expect(v.ok).toBe(true);
      expect(v.titulo).toBe('Íntegro y verificado');
    });

    it('traduce motivos conocidos a texto legible en español', () => {
      expect(veredictoVista(false, 'REFERENCIA_ALTERADA').detalle).toContain('cambió desde que se emitió');
      expect(veredictoVista(false, 'ANCLA_NO_CUADRA').detalle).toContain('ancla de auditoría no coincide');
      expect(veredictoVista(false, 'CADENA_CONTENIDO_ALTERADO').detalle).toContain('contenido de una entrada');
    });

    it('es honesto con un motivo desconocido: lo muestra sin inventar una causa', () => {
      const v = veredictoVista(false, 'MOTIVO_RARO');
      expect(v.ok).toBe(false);
      expect(v.detalle).toContain('MOTIVO_RARO');
    });

    it('no revienta sin motivo', () => {
      expect(veredictoVista(false).detalle).toBe('No verifica.');
    });
  });

  describe('formatCostoTotal', () => {
    it('devuelve guion cuando no hay valor o no es número', () => {
      expect(formatCostoTotal(null)).toBe('—');
      expect(formatCostoTotal(undefined)).toBe('—');
      expect(formatCostoTotal('')).toBe('—');
      expect(formatCostoTotal('abc')).toBe('—');
    });

    it('formatea un decimal string del backend como USD', () => {
      expect(formatCostoTotal('0.00000000')).toContain('0,00');
      expect(formatCostoTotal('12.50000000')).toContain('12,50');
    });
  });

  describe('autorPasaporte', () => {
    it('distingue autor humano cuando hay emisor', () => {
      const a = autorPasaporte('u1');
      expect(a.tipo).toBe('humano');
      expect(a.icon).toBe('user');
    });

    it('marca autor digital/sistema cuando no hay emisor', () => {
      expect(autorPasaporte(null).tipo).toBe('digital');
      expect(autorPasaporte(undefined).tipo).toBe('digital');
    });
  });

  describe('conteosVista', () => {
    it('refleja los totales y longitudes reales sin inventar datos', () => {
      const doc = docVacio();
      doc.agentes = [{ agentId: 'a', roles: ['ejecutor'], responsableUserId: null, agentVersionId: null }];
      doc.totales.numEjecuciones = 3;
      const vista = conteosVista(doc);
      expect(vista.find((c) => c.label === 'Agentes')?.valor).toBe(1);
      expect(vista.find((c) => c.label === 'Ejecuciones')?.valor).toBe(3);
      expect(vista.find((c) => c.label === 'Conectores')?.valor).toBe(0);
    });
  });

  describe('claveAlmacen', () => {
    it('construye una clave estable por contrato', () => {
      expect(claveAlmacen('c1')).toBe('nexo.pasaporte.c1');
    });
  });
});
