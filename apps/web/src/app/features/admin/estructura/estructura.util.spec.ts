import type { OrgUnit } from '../../../core/models';
import {
  ESTADO_META,
  TIPO_ASIGNACION_META,
  TIPO_META,
  asignacionVigente,
  badgeClass,
  destinoField,
  empresaNombre,
  empresasDe,
  estadoLabel,
  tipoAsignacionLabel,
  tipoLabel,
  validarVigencia,
} from './estructura.util';
import {
  ESTADOS_ESTRUCTURA,
  ORG_UNIT_TIPOS,
  TIPOS_ASIGNACION,
  type EstadoEstructura,
  type OrgUnitTipo,
  type TipoAsignacion,
} from '../../../core/estructura.models';

function unit(partial: Partial<OrgUnit> & Pick<OrgUnit, 'id' | 'name' | 'tipo'>): OrgUnit {
  return {
    code: null,
    parentId: null,
    allowedModels: [],
    memberCount: 0,
    isRoot: false,
    empresaId: null,
    responsableUserId: null,
    estado: 'ACTIVA',
    vigenteDesde: null,
    vigenteHasta: null,
    ...partial,
  };
}

describe('TIPO_META / tipoLabel', () => {
  it('define etiqueta, ícono y tono para cada tipo de unidad', () => {
    for (const t of ORG_UNIT_TIPOS as OrgUnitTipo[]) {
      const meta = TIPO_META[t];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.icon.length).toBeGreaterThan(0);
      expect(['neutral', 'info', 'success', 'warning', 'danger', 'primary']).toContain(meta.tono);
    }
    expect(tipoLabel('EMPRESA')).toBe('Empresa');
    expect(tipoLabel('AREA_FUNCIONAL')).toBe('Área funcional');
  });
});

describe('ESTADO_META / estadoLabel', () => {
  it('cubre los tres estados en español', () => {
    for (const e of ESTADOS_ESTRUCTURA as EstadoEstructura[]) {
      expect(ESTADO_META[e].label.length).toBeGreaterThan(0);
    }
    expect(estadoLabel('ACTIVA')).toBe('Activa');
    expect(estadoLabel('CERRADA')).toBe('Cerrada');
  });
});

describe('TIPO_ASIGNACION_META / destinoField', () => {
  it('define metadatos para cada tipo de asignación', () => {
    for (const t of TIPOS_ASIGNACION as TipoAsignacion[]) {
      expect(TIPO_ASIGNACION_META[t].label.length).toBeGreaterThan(0);
    }
    expect(tipoAsignacionLabel('LINEA')).toBe('Línea de negocio');
  });

  it('mapea cada tipo a su campo destino', () => {
    expect(destinoField('FUNCIONAL_PRINCIPAL')).toBe('orgUnitId');
    expect(destinoField('SERVICIO')).toBe('orgUnitId');
    expect(destinoField('LINEA')).toBe('lineaNegocioId');
    expect(destinoField('SEDE')).toBe('sedeId');
    expect(destinoField('PROYECTO')).toBe('proyectoId');
  });
});

describe('badgeClass', () => {
  it('solo deja la clase base para el tono neutral', () => {
    expect(badgeClass('neutral')).toBe('badge');
  });

  it('agrega la clase de tono para los demás', () => {
    expect(badgeClass('success')).toBe('badge success');
    expect(badgeClass('warning')).toBe('badge warning');
    expect(badgeClass('primary')).toBe('badge primary');
  });
});

describe('asignacionVigente', () => {
  const now = new Date('2026-06-01T00:00:00Z');

  it('es vigente cuando está ACTIVA y sin fin de vigencia', () => {
    expect(asignacionVigente({ estado: 'ACTIVA', vigenteHasta: null }, now)).toBe(true);
  });

  it('es vigente cuando el fin de vigencia está en el futuro', () => {
    expect(asignacionVigente({ estado: 'ACTIVA', vigenteHasta: '2026-12-31T00:00:00Z' }, now)).toBe(true);
  });

  it('no es vigente cuando el fin ya pasó (histórica)', () => {
    expect(asignacionVigente({ estado: 'ACTIVA', vigenteHasta: '2026-01-01T00:00:00Z' }, now)).toBe(false);
  });

  it('no es vigente si el estado no es ACTIVA aunque no tenga fin', () => {
    expect(asignacionVigente({ estado: 'CERRADA', vigenteHasta: null }, now)).toBe(false);
    expect(asignacionVigente({ estado: 'SUSPENDIDA', vigenteHasta: null }, now)).toBe(false);
  });
});

describe('validarVigencia', () => {
  it('acepta vigencias abiertas (sin fechas o con una sola)', () => {
    expect(validarVigencia(null, null)).toBeNull();
    expect(validarVigencia('2026-01-01', null)).toBeNull();
    expect(validarVigencia(null, '2026-01-01')).toBeNull();
  });

  it('acepta un rango válido', () => {
    expect(validarVigencia('2026-01-01', '2026-12-31')).toBeNull();
  });

  it('rechaza inicio posterior al fin', () => {
    expect(validarVigencia('2026-12-31', '2026-01-01')).toContain('no puede ser posterior');
  });

  it('rechaza fechas inválidas', () => {
    expect(validarVigencia('no-es-fecha', '2026-01-01')).toContain('no son válidas');
  });
});

describe('empresasDe / empresaNombre', () => {
  const units: OrgUnit[] = [
    unit({ id: 'g', name: 'Grupo', tipo: 'GRUPO' }),
    unit({ id: 'e2', name: 'Zeta', tipo: 'EMPRESA' }),
    unit({ id: 'e1', name: 'Alfa', tipo: 'EMPRESA' }),
    unit({ id: 'a', name: 'Área', tipo: 'AREA_FUNCIONAL' }),
  ];

  it('filtra solo empresas y las ordena por nombre', () => {
    expect(empresasDe(units).map((u) => u.id)).toEqual(['e1', 'e2']);
  });

  it('resuelve el nombre de la empresa por id', () => {
    expect(empresaNombre(units, 'e1')).toBe('Alfa');
    expect(empresaNombre(units, null)).toBe('—');
    expect(empresaNombre(units, 'inexistente')).toBe('—');
  });
});
