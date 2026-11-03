import { conSchemaVersion, MISION_SCHEMA_VERSION, upcastPayload, versionDe } from './mission.payload';

/**
 * Versionado de la forma JSON de misiones (ADR 0016 · decisión 7). Prueba aislada (TS puro): estampado de
 * `schemaVersion`, lectura tolerante y upcasting aditivo que nunca rompe un JSON ya guardado (Incremento 1 = v0).
 */
describe('mission.payload — schemaVersion y upcasting (ADR 0016 D7)', () => {
  describe('versionDe', () => {
    it('trata un JSON sin schemaVersion como v0 (datos del Incremento 1)', () => {
      expect(versionDe({ alcance: 'cobro' })).toBe(0);
      expect(versionDe({})).toBe(0);
    });

    it('lee la versión declarada cuando existe', () => {
      expect(versionDe({ schemaVersion: 1 })).toBe(1);
    });

    it('ignora valores inválidos (negativos, no enteros, no objeto)', () => {
      expect(versionDe({ schemaVersion: -1 })).toBe(0);
      expect(versionDe({ schemaVersion: 1.5 })).toBe(0);
      expect(versionDe(null)).toBe(0);
      expect(versionDe('texto')).toBe(0);
      expect(versionDe([1, 2])).toBe(0);
    });
  });

  describe('conSchemaVersion', () => {
    it('estampa la versión actual sin mutar la entrada ni perder claves', () => {
      const entrada = { origen: 'INCUMPLIMIENTO', refs: { incumplimientoId: 'x' } };
      const salida = conSchemaVersion(entrada);
      expect(salida.schemaVersion).toBe(MISION_SCHEMA_VERSION);
      expect(salida.origen).toBe('INCUMPLIMIENTO');
      expect((entrada as Record<string, unknown>).schemaVersion).toBeUndefined();
    });

    it('envuelve un valor no-objeto sin perder información', () => {
      expect(conSchemaVersion('cobro')).toEqual({ valor: 'cobro', schemaVersion: MISION_SCHEMA_VERSION });
      expect(conSchemaVersion(null)).toEqual({ valor: null, schemaVersion: MISION_SCHEMA_VERSION });
    });
  });

  describe('upcastPayload', () => {
    it('sube un JSON v0 (sin campo) a la versión actual de forma aditiva (conserva datos)', () => {
      const viejo = { alcance: 'cobro', areas: ['tesoreria'] };
      const nuevo = upcastPayload(viejo);
      expect(nuevo.schemaVersion).toBe(MISION_SCHEMA_VERSION);
      expect(nuevo.alcance).toBe('cobro');
      expect(nuevo.areas).toEqual(['tesoreria']);
    });

    it('es idempotente sobre un JSON ya en la versión actual', () => {
      const actual = { schemaVersion: MISION_SCHEMA_VERSION, dato: 1 };
      expect(upcastPayload(actual)).toEqual(actual);
    });
  });
});
