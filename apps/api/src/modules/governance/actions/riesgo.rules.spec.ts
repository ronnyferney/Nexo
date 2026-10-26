import { clasificarRiesgo } from './riesgo.rules';

/**
 * Especificación viva de la clasificación de riesgo pura (E6+ · punto 8). Comprueba las reglas duras: DESCONOCIDO/
 * contradictorio/sin evidencia detiene y escala; los niveles disparan el control correcto; y que NO se expone un
 * puntaje numérico (no hay score calibrado) ni se usa "consenso de modelos" como señal.
 */
describe('clasificarRiesgo (reglas puras de riesgo E6+)', () => {
  it('sin evidencia suficiente → DESCONOCIDO: detener y escalar', () => {
    const r = clasificarRiesgo({ impactoPotencial: 'BAJO' }); // no se afirma evidenciaSuficiente
    expect(r.nivel).toBe('DESCONOCIDO');
    expect(r.control).toBe('DETENER_Y_ESCALAR');
    expect(r.detener).toBe(true);
    expect(r.escalar).toBe(true);
    expect(r.automatizable).toBe(false);
    expect(r.señales).toContain('EVIDENCIA_INSUFICIENTE');
  });

  it('señales contradictorias → DESCONOCIDO aunque haya evidencia', () => {
    const r = clasificarRiesgo({ evidenciaSuficiente: true, señalesContradictorias: true, impactoPotencial: 'BAJO' });
    expect(r.nivel).toBe('DESCONOCIDO');
    expect(r.detener).toBe(true);
    expect(r.señales).toContain('SEÑALES_CONTRADICTORIAS');
  });

  it('nivel por defecto DESCONOCIDO del catálogo también detiene y escala', () => {
    const r = clasificarRiesgo({ evidenciaSuficiente: true, nivelPorDefecto: 'DESCONOCIDO', impactoPotencial: 'BAJO' });
    expect(r.nivel).toBe('DESCONOCIDO');
    expect(r.control).toBe('DETENER_Y_ESCALAR');
  });

  it('BAJO que cumple reglas → automatizable', () => {
    const r = clasificarRiesgo({ evidenciaSuficiente: true, impactoPotencial: 'BAJO', cumpleReglas: true });
    expect(r.nivel).toBe('BAJO');
    expect(r.control).toBe('AUTOMATIZABLE');
    expect(r.automatizable).toBe(true);
    expect(r.requiereRevisionHumana).toBe(false);
  });

  it('BAJO que NO cumple reglas → revisión humana (no automatizable)', () => {
    const r = clasificarRiesgo({ evidenciaSuficiente: true, impactoPotencial: 'BAJO', cumpleReglas: false });
    expect(r.nivel).toBe('BAJO');
    expect(r.control).toBe('REVISION_HUMANA');
    expect(r.automatizable).toBe(false);
  });

  it('MEDIO → revisión humana', () => {
    const r = clasificarRiesgo({ evidenciaSuficiente: true, impactoPotencial: 'MEDIO', cumpleReglas: true });
    expect(r.nivel).toBe('MEDIO');
    expect(r.control).toBe('REVISION_HUMANA');
    expect(r.automatizable).toBe(false);
  });

  it('ALTO → revisión humana OBLIGATORIA', () => {
    const r = clasificarRiesgo({ evidenciaSuficiente: true, impactoPotencial: 'ALTO', reversible: true });
    expect(r.nivel).toBe('ALTO');
    expect(r.control).toBe('REVISION_HUMANA_OBLIGATORIA');
  });

  it('impacto ALTO e irreversible escala a CRITICO', () => {
    const r = clasificarRiesgo({ evidenciaSuficiente: true, impactoPotencial: 'ALTO', reversible: false });
    expect(r.nivel).toBe('CRITICO');
    expect(r.control).toBe('REVISION_HUMANA_OBLIGATORIA');
    expect(r.señales).toContain('IMPACTO_ALTO_IRREVERSIBLE');
  });

  it('el nivel por defecto del catálogo actúa como PISO (gana el más severo)', () => {
    const r = clasificarRiesgo({
      evidenciaSuficiente: true,
      impactoPotencial: 'BAJO',
      nivelPorDefecto: 'ALTO',
      cumpleReglas: true,
    });
    expect(r.nivel).toBe('ALTO');
    expect(r.señales).toContain('PISO_CATALOGO_ALTO');
  });

  it('producción con datos sensibles nunca queda en BAJO', () => {
    const r = clasificarRiesgo({
      evidenciaSuficiente: true,
      impactoPotencial: 'BAJO',
      afectaProduccion: true,
      datosSensibles: true,
      cumpleReglas: true,
    });
    expect(r.nivel).toBe('MEDIO');
    expect(r.señales).toContain('PRODUCCION_CON_DATOS_SENSIBLES');
  });

  it('nunca expone un puntaje numérico calibrado (scoreCalibrado = false siempre)', () => {
    const casos = [
      clasificarRiesgo({ evidenciaSuficiente: true, impactoPotencial: 'BAJO', cumpleReglas: true }),
      clasificarRiesgo({ impactoPotencial: 'CRITICO' }),
      clasificarRiesgo({ evidenciaSuficiente: true, impactoPotencial: 'CRITICO' }),
    ];
    for (const c of casos) {
      expect(c.scoreCalibrado).toBe(false);
      // No debe filtrarse ningún campo tipo "score"/"porcentaje" numérico.
      expect(Object.keys(c)).not.toContain('score');
      expect(Object.keys(c)).not.toContain('porcentaje');
    }
  });

  it('es determinista: misma entrada → misma salida', () => {
    const entrada = { evidenciaSuficiente: true, impactoPotencial: 'MEDIO' as const, cumpleReglas: true };
    expect(clasificarRiesgo(entrada)).toEqual(clasificarRiesgo(entrada));
  });
});
