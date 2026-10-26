import type { Excepcion } from '../../core/excepciones.models';
import {
  accionDisponible,
  antiguedadMs,
  conciliacion,
  filtrarBandeja,
  isCerrada,
  ordenarBandeja,
  puedeAccion,
} from './excepciones.util';

const AHORA = new Date('2026-10-26T12:00:00Z').getTime();

function exc(over: Partial<Excepcion> = {}): Excepcion {
  return {
    id: 'e1',
    workspaceId: 'w1',
    causa: 'timeout',
    clase: 'TEMPORAL',
    evidencia: {},
    origen: 'MOTOR_DURABLE',
    estado: 'ABIERTA',
    createdAt: '2026-10-26T10:00:00Z',
    updatedAt: '2026-10-26T10:00:00Z',
    ...over,
  };
}

describe('isCerrada', () => {
  it('considera cerradas las excepciones terminales', () => {
    expect(isCerrada('CANCELADA')).toBe(true);
    expect(isCerrada('RESUELTA')).toBe(true);
    expect(isCerrada('CONCILIADA')).toBe(true);
    expect(isCerrada('ABIERTA')).toBe(false);
    expect(isCerrada('EN_PROGRESO')).toBe(false);
    expect(isCerrada('REASIGNADA')).toBe(false);
  });
});

describe('accionDisponible', () => {
  it('bloquea las acciones generales en estados cerrados', () => {
    for (const accion of ['info', 'reintentar', 'reasignar', 'cancelar'] as const) {
      expect(accionDisponible('ABIERTA', accion)).toBe(true);
      expect(accionDisponible('CANCELADA', accion)).toBe(false);
      expect(accionDisponible('CONCILIADA', accion)).toBe(false);
    }
  });

  it('permite conciliar incluso una ya conciliada, pero no una cancelada/resuelta', () => {
    expect(accionDisponible('CONCILIADA', 'conciliar')).toBe(true);
    expect(accionDisponible('EN_PROGRESO', 'conciliar')).toBe(true);
    expect(accionDisponible('CANCELADA', 'conciliar')).toBe(false);
    expect(accionDisponible('RESUELTA', 'conciliar')).toBe(false);
  });
});

describe('puedeAccion', () => {
  it('exige permiso de edición', () => {
    expect(puedeAccion('ABIERTA', 'reintentar', false)).toEqual({
      ok: false,
      mensaje: 'Se necesita rol Editor o superior para actuar sobre la excepción.',
    });
  });

  it('permite la acción a un editor sobre un estado válido', () => {
    expect(puedeAccion('ABIERTA', 'reintentar', true)).toEqual({ ok: true });
  });

  it('bloquea con mensaje legible una acción no disponible por estado', () => {
    const g = puedeAccion('CANCELADA', 'reintentar', true);
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.mensaje).toContain('Cancelada');
  });
});

describe('conciliacion', () => {
  it('marca confirmado cuando la excepción está conciliada o resuelta', () => {
    expect(conciliacion(exc({ estado: 'CONCILIADA' })).estado).toBe('CONFIRMADO');
    expect(conciliacion(exc({ estado: 'RESUELTA' })).estado).toBe('CONFIRMADO');
  });

  it('marca incierto una escritura incierta o una clase INCIERTO aún abierta', () => {
    expect(conciliacion(exc({ origen: 'ESCRITURA_INCIERTA', estado: 'ABIERTA' })).estado).toBe('INCIERTO');
    expect(conciliacion(exc({ clase: 'INCIERTO', estado: 'EN_PROGRESO' })).estado).toBe('INCIERTO');
  });

  it('marca pendiente el resto de abiertas y no aplica para canceladas', () => {
    expect(conciliacion(exc({ estado: 'ABIERTA', clase: 'TEMPORAL', origen: 'MOTOR_DURABLE' })).estado).toBe(
      'PENDIENTE',
    );
    expect(conciliacion(exc({ estado: 'CANCELADA' })).estado).toBe('NO_APLICA');
  });
});

describe('antiguedadMs', () => {
  it('calcula la edad desde la creación y nunca es negativa', () => {
    expect(antiguedadMs('2026-10-26T10:00:00Z', AHORA)).toBe(2 * 3600 * 1000);
    expect(antiguedadMs('2026-10-26T13:00:00Z', AHORA)).toBe(0);
  });
});

describe('ordenarBandeja', () => {
  it('pone primero las abiertas, luego por severidad de clase y a igualdad las más antiguas', () => {
    const items = [
      exc({ id: 'cerrada', estado: 'CONCILIADA', clase: 'INCIERTO', createdAt: '2026-10-26T01:00:00Z' }),
      exc({ id: 'temporal-nueva', estado: 'ABIERTA', clase: 'TEMPORAL', createdAt: '2026-10-26T11:00:00Z' }),
      exc({ id: 'incierta', estado: 'ABIERTA', clase: 'INCIERTO', createdAt: '2026-10-26T11:30:00Z' }),
      exc({ id: 'temporal-vieja', estado: 'ABIERTA', clase: 'TEMPORAL', createdAt: '2026-10-26T09:00:00Z' }),
    ];
    const orden = ordenarBandeja(items).map((i) => i.id);
    expect(orden).toEqual(['incierta', 'temporal-vieja', 'temporal-nueva', 'cerrada']);
  });

  it('no muta el arreglo de entrada', () => {
    const items = [exc({ id: 'a' }), exc({ id: 'b', estado: 'CANCELADA' })];
    const copia = [...items];
    ordenarBandeja(items);
    expect(items).toEqual(copia);
  });
});

describe('filtrarBandeja', () => {
  const items = [
    exc({ id: 'a', clase: 'TEMPORAL', origen: 'MOTOR_DURABLE' }),
    exc({ id: 'b', clase: 'INCIERTO', origen: 'ESCRITURA_INCIERTA' }),
    exc({ id: 'c', clase: 'PERMANENTE', origen: 'MANUAL' }),
  ];

  it('sin filtros devuelve todo', () => {
    expect(filtrarBandeja(items, {}).length).toBe(3);
  });

  it('filtra por clase y por origen', () => {
    expect(filtrarBandeja(items, { clase: 'INCIERTO' }).map((i) => i.id)).toEqual(['b']);
    expect(filtrarBandeja(items, { origen: 'MANUAL' }).map((i) => i.id)).toEqual(['c']);
    expect(filtrarBandeja(items, { clase: 'TEMPORAL', origen: 'ESCRITURA_INCIERTA' }).length).toBe(0);
  });
});
