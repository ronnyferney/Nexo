import type { AuditEntry, AuditVerification } from '../../core/audit.models';
import {
  actionLabel,
  actorTypeIcon,
  actorTypeLabel,
  breakReasonLabel,
  formatActor,
  formatTarget,
  hasActiveFilters,
  hasMetadata,
  humanizeAction,
  prettyMetadata,
  toSeal,
} from './auditoria.util';

function entry(partial: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'a1',
    workspaceId: 'w1',
    seq: 1,
    createdAt: '2026-10-26T12:00:00.000Z',
    actorType: 'USER',
    actorId: 'u-123',
    action: 'APROBACION_CONCEDIDA',
    targetType: 'Aprobacion',
    targetId: 'ap-9',
    resumen: 'Aprobó la solicitud',
    metadata: {},
    contentHash: 'c',
    prevHash: 'p',
    hash: 'h',
    ...partial,
  };
}

describe('auditoria.util', () => {
  describe('actionLabel / humanizeAction', () => {
    it('traduce las acciones conocidas a etiquetas en español', () => {
      expect(actionLabel('APROBACION_CONCEDIDA')).toBe('Aprobación concedida');
      expect(actionLabel('PASAPORTE_EMITIDO')).toBe('Pasaporte emitido');
      expect(actionLabel('CUADRILLA_PUBLICADA')).toBe('Cuadrilla publicada');
      expect(actionLabel('JERARQUIA_MODIFICADA')).toBe('Jerarquía modificada');
      expect(actionLabel('PARAMETROS_EJECUCION_MODIFICADOS')).toBe('Parámetros de ejecución modificados');
    });

    it('para acciones desconocidas devuelve un fallback legible, nunca el crudo con guiones', () => {
      expect(actionLabel('FOO_BAR_BAZ')).toBe('Foo bar baz');
      expect(actionLabel('NUEVO_HECHO')).toBe('Nuevo hecho');
    });

    it('humanizeAction nunca devuelve vacío', () => {
      expect(humanizeAction('')).toBe('—');
      expect(humanizeAction('   ')).toBe('—');
      expect(humanizeAction('X')).toBe('X');
    });
  });

  describe('actor', () => {
    it('etiqueta e ícono por tipo', () => {
      expect(actorTypeLabel('USER')).toBe('Persona');
      expect(actorTypeLabel('AGENT')).toBe('Agente');
      expect(actorTypeLabel('SYSTEM')).toBe('Sistema');
      expect(actorTypeIcon('USER')).toBe('user');
      expect(actorTypeIcon('AGENT')).toBe('bot');
      expect(actorTypeIcon('SYSTEM')).toBe('cpu');
    });

    it('formatActor combina tipo e id, salvo SYSTEM que no lleva id', () => {
      expect(formatActor('USER', 'u-1')).toBe('Persona · u-1');
      expect(formatActor('AGENT', 'ag-5')).toBe('Agente · ag-5');
      expect(formatActor('SYSTEM', null)).toBe('Sistema');
      expect(formatActor('SYSTEM', 'ignorado')).toBe('Sistema');
      expect(formatActor('USER', null)).toBe('Persona');
    });
  });

  describe('formatTarget', () => {
    it('combina tipo e id, o muestra el que haya, o — si no hay', () => {
      expect(formatTarget('Politica', 'pol-1')).toBe('Politica · pol-1');
      expect(formatTarget('Politica', null)).toBe('Politica');
      expect(formatTarget(null, 'x')).toBe('x');
      expect(formatTarget(null, null)).toBe('—');
    });
  });

  describe('toSeal', () => {
    it('cadena íntegra con hechos', () => {
      const v: AuditVerification = { ok: true, total: 3 };
      const s = toSeal(v);
      expect(s.ok).toBeTrue();
      expect(s.titulo).toBe('Cadena íntegra');
      expect(s.icon).toBe('check');
      expect(s.detalle).toContain('3 hechos');
    });

    it('cadena íntegra en singular y vacía', () => {
      expect(toSeal({ ok: true, total: 1 }).detalle).toContain('1 hecho');
      expect(toSeal({ ok: true, total: 0 }).detalle).toContain('Todavía no hay hechos');
    });

    it('cadena comprometida indica seq y motivo legible', () => {
      const v: AuditVerification = { ok: false, total: 10, rotaEnSeq: 7, motivo: 'CONTENIDO_ALTERADO' };
      const s = toSeal(v);
      expect(s.ok).toBeFalse();
      expect(s.titulo).toBe('Cadena comprometida');
      expect(s.icon).toBe('alert');
      expect(s.rotaEnSeq).toBe(7);
      expect(s.detalle).toContain('#7');
      expect(s.detalle).toContain('El contenido de una entrada fue alterado');
    });

    it('cadena comprometida sin seq ni motivo conocido no rompe', () => {
      const s = toSeal({ ok: false, total: 2 });
      expect(s.ok).toBeFalse();
      expect(s.detalle).toContain('La cadena no superó la verificación');
    });
  });

  describe('breakReasonLabel', () => {
    it('traduce los motivos conocidos y deja pasar los desconocidos', () => {
      expect(breakReasonLabel('ENLACE_ROTO')).toBe('El enlace de hash entre entradas no cuadra');
      expect(breakReasonLabel('SECUENCIA_ROTA')).toContain('Falta una entrada');
      expect(breakReasonLabel('OTRO')).toBe('OTRO');
      expect(breakReasonLabel(undefined)).toContain('no superó la verificación');
    });
  });

  describe('hasActiveFilters', () => {
    const empty = { action: '', targetType: '', targetId: '', desde: '', hasta: '' };
    it('false sin filtros, true con alguno', () => {
      expect(hasActiveFilters(empty)).toBeFalse();
      expect(hasActiveFilters({ ...empty, action: 'X' })).toBeTrue();
      expect(hasActiveFilters({ ...empty, targetId: 'id' })).toBeTrue();
      expect(hasActiveFilters({ ...empty, desde: '2026-01-01' })).toBeTrue();
    });
  });

  describe('metadata', () => {
    it('hasMetadata distingue objeto vacío de con claves', () => {
      expect(hasMetadata(entry({ metadata: {} }))).toBeFalse();
      expect(hasMetadata(entry({ metadata: { foo: 1 } }))).toBeTrue();
    });

    it('prettyMetadata serializa con indentación y tolera valores raros', () => {
      expect(prettyMetadata({ a: 1 })).toContain('"a": 1');
      expect(prettyMetadata(null)).toBe('{}');
    });
  });
});
