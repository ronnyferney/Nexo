import type { Publicacion } from '../../core/community.models';
import {
  corto,
  estadoPublicacionMeta,
  formatearConteo,
  permiteTarea,
  puedeArchivar,
  puedeModerar,
  puedeResolver,
  reaccionMeta,
  tipoPublicacionMeta,
} from './comunidad.util';

function pub(partial: Partial<Publicacion> = {}): Publicacion {
  return {
    id: partial.id ?? 'p1',
    workspaceId: 'w1',
    autorUserId: partial.autorUserId ?? 'u1',
    orgUnitId: partial.orgUnitId ?? null,
    tipo: partial.tipo ?? 'NOVEDAD',
    titulo: partial.titulo ?? null,
    cuerpo: partial.cuerpo ?? 'Hola equipo',
    tareaId: partial.tareaId ?? null,
    estado: partial.estado ?? 'ACTIVA',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    _count: partial._count,
  };
}

describe('comunidad.util', () => {
  describe('metadatos de presentación', () => {
    it('cada tipo de publicación tiene etiqueta, color e ícono distintivos', () => {
      expect(tipoPublicacionMeta('NOVEDAD').label).toBe('Novedad');
      expect(tipoPublicacionMeta('APOYO').badge).toBe('warning');
      expect(tipoPublicacionMeta('APRENDIZAJE').icon).toBe('graduation');
      expect(tipoPublicacionMeta('COMPROMISO').badge).toBe('primary');
      const iconos = (['NOVEDAD', 'APOYO', 'APRENDIZAJE', 'COMPROMISO'] as const).map((t) => tipoPublicacionMeta(t).icon);
      expect(new Set(iconos).size).toBe(4);
    });

    it('el estado resuelto se destaca en verde y el archivado en rojo', () => {
      expect(estadoPublicacionMeta('RESUELTA').badge).toBe('success');
      expect(estadoPublicacionMeta('ARCHIVADA').badge).toBe('danger');
      expect(estadoPublicacionMeta('ACTIVA').badge).toBe('');
    });

    it('cada reacción tiene etiqueta e ícono', () => {
      expect(reaccionMeta('like').icon).toBe('thumbsUp');
      expect(reaccionMeta('celebrar').label).toBe('Celebrar');
      expect(reaccionMeta('apoyo').icon).toBe('heartPulse');
    });
  });

  describe('permiteTarea', () => {
    it('solo un COMPROMISO o un APOYO puede ligar una tarea', () => {
      expect(permiteTarea('COMPROMISO')).toBeTrue();
      expect(permiteTarea('APOYO')).toBeTrue();
      expect(permiteTarea('NOVEDAD')).toBeFalse();
      expect(permiteTarea('APRENDIZAJE')).toBeFalse();
    });
  });

  describe('puedeModerar', () => {
    it('modera el autor o un administrador', () => {
      const p = pub({ autorUserId: 'u1' });
      expect(puedeModerar(p, 'u1', false)).toBeTrue();
      expect(puedeModerar(p, 'u2', false)).toBeFalse();
      expect(puedeModerar(p, 'u2', true)).toBeTrue();
      expect(puedeModerar(p, null, false)).toBeFalse();
    });
  });

  describe('puedeResolver', () => {
    it('marca RESUELTA solo un APOYO/COMPROMISO activo de quien puede moderar', () => {
      expect(puedeResolver(pub({ tipo: 'APOYO', estado: 'ACTIVA', autorUserId: 'u1' }), 'u1', false)).toBeTrue();
      expect(puedeResolver(pub({ tipo: 'COMPROMISO', estado: 'ACTIVA', autorUserId: 'u9' }), 'u1', true)).toBeTrue();
    });

    it('no ofrece resolver una novedad/aprendizaje ni una ya resuelta/archivada', () => {
      expect(puedeResolver(pub({ tipo: 'NOVEDAD', estado: 'ACTIVA', autorUserId: 'u1' }), 'u1', false)).toBeFalse();
      expect(puedeResolver(pub({ tipo: 'APOYO', estado: 'RESUELTA', autorUserId: 'u1' }), 'u1', false)).toBeFalse();
      expect(puedeResolver(pub({ tipo: 'APOYO', estado: 'ACTIVA', autorUserId: 'u1' }), 'u2', false)).toBeFalse();
    });
  });

  describe('puedeArchivar', () => {
    it('archiva cualquier publicación no archivada de quien puede moderar', () => {
      expect(puedeArchivar(pub({ estado: 'ACTIVA', autorUserId: 'u1' }), 'u1', false)).toBeTrue();
      expect(puedeArchivar(pub({ estado: 'RESUELTA', autorUserId: 'u9' }), 'u1', true)).toBeTrue();
      expect(puedeArchivar(pub({ estado: 'ARCHIVADA', autorUserId: 'u1' }), 'u1', false)).toBeFalse();
      expect(puedeArchivar(pub({ estado: 'ACTIVA', autorUserId: 'u1' }), 'u2', false)).toBeFalse();
    });
  });

  describe('formatearConteo', () => {
    it('muestra literal por debajo de mil', () => {
      expect(formatearConteo(0)).toBe('0');
      expect(formatearConteo(7)).toBe('7');
      expect(formatearConteo(999)).toBe('999');
    });

    it('usa el sufijo «k» a partir de mil (coma decimal es-ES)', () => {
      expect(formatearConteo(1000)).toBe('1 k');
      expect(formatearConteo(1500)).toBe('1,5 k');
      expect(formatearConteo(12000)).toBe('12 k');
    });

    it('nunca devuelve negativos ni decimales y tolera null/undefined', () => {
      expect(formatearConteo(-5)).toBe('0');
      expect(formatearConteo(null)).toBe('0');
      expect(formatearConteo(undefined)).toBe('0');
      expect(formatearConteo(3.9)).toBe('3');
    });
  });

  describe('corto', () => {
    it('acorta un id y tolera vacío', () => {
      expect(corto('abcdef123456')).toBe('…123456');
      expect(corto(null)).toBe('—');
      expect(corto('')).toBe('—');
    });
  });
});
