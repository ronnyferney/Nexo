import { clasificarFallo, decidirAccion, evaluarFallo } from './failure-classification';

/**
 * RF20: clasificación TEMPORAL/PERMANENTE/INCIERTO y la decisión derivada. TEMPORAL (operación segura) se REINTENTA;
 * PERMANENTE NO se reintenta; INCIERTO (y TEMPORAL no seguro) va a CONCILIAR, nunca a reintento a ciegas. Lógica pura.
 */
describe('clasificarFallo (RF20)', () => {
  it('timeout/red sobre operación segura es TEMPORAL', () => {
    expect(clasificarFallo({ tipo: 'timeout', operacionSegura: true })).toBe('TEMPORAL');
    expect(clasificarFallo({ tipo: 'red', operacionSegura: true })).toBe('TEMPORAL');
  });

  it('timeout/red sobre operación NO segura es INCIERTO (no sabemos si el efecto llegó)', () => {
    expect(clasificarFallo({ tipo: 'timeout', operacionSegura: false })).toBe('INCIERTO');
    expect(clasificarFallo({ tipo: 'red', operacionSegura: false })).toBe('INCIERTO');
  });

  it('HTTP 429/5xx es temporal por convención (TEMPORAL si la operación es segura)', () => {
    expect(clasificarFallo({ tipo: 'http', httpStatus: 429, operacionSegura: true })).toBe('TEMPORAL');
    expect(clasificarFallo({ tipo: 'http', httpStatus: 503, operacionSegura: true })).toBe('TEMPORAL');
    expect(clasificarFallo({ tipo: 'http', httpStatus: 503, operacionSegura: false })).toBe('INCIERTO');
  });

  it('HTTP 4xx (salvo 408/425/429) es PERMANENTE', () => {
    expect(clasificarFallo({ tipo: 'http', httpStatus: 400, operacionSegura: true })).toBe('PERMANENTE');
    expect(clasificarFallo({ tipo: 'http', httpStatus: 404, operacionSegura: true })).toBe('PERMANENTE');
    expect(clasificarFallo({ tipo: 'http', httpStatus: 422, operacionSegura: false })).toBe('PERMANENTE');
  });

  it('un error de validación local es PERMANENTE', () => {
    expect(clasificarFallo({ tipo: 'validacion', operacionSegura: true })).toBe('PERMANENTE');
  });

  it('un despacho marcado INCIERTO es siempre INCIERTO (la escritura pudo salir)', () => {
    expect(clasificarFallo({ despachoStatus: 'INCIERTO', operacionSegura: true })).toBe('INCIERTO');
  });

  it('sin señal clara es INCIERTO (conservador: se concilia, no se reintenta a ciegas)', () => {
    expect(clasificarFallo({ tipo: 'desconocido' })).toBe('INCIERTO');
    expect(clasificarFallo({})).toBe('INCIERTO');
  });
});

describe('decidirAccion (RF20)', () => {
  it('TEMPORAL reintenta solo si la operación es segura', () => {
    expect(decidirAccion('TEMPORAL', true)).toBe('REINTENTAR');
    expect(decidirAccion('TEMPORAL', false)).toBe('CONCILIAR');
  });

  it('PERMANENTE no se reintenta', () => {
    expect(decidirAccion('PERMANENTE', true)).toBe('NO_REINTENTAR');
    expect(decidirAccion('PERMANENTE', false)).toBe('NO_REINTENTAR');
  });

  it('INCIERTO va a conciliación (nunca reintento a ciegas)', () => {
    expect(decidirAccion('INCIERTO', true)).toBe('CONCILIAR');
    expect(decidirAccion('INCIERTO', false)).toBe('CONCILIAR');
  });
});

describe('evaluarFallo', () => {
  it('combina clasificación y decisión', () => {
    expect(evaluarFallo({ tipo: 'timeout', operacionSegura: true })).toEqual({
      clase: 'TEMPORAL',
      accion: 'REINTENTAR',
    });
    expect(evaluarFallo({ tipo: 'http', httpStatus: 400 })).toEqual({ clase: 'PERMANENTE', accion: 'NO_REINTENTAR' });
    expect(evaluarFallo({ despachoStatus: 'INCIERTO' })).toEqual({ clase: 'INCIERTO', accion: 'CONCILIAR' });
  });
});
