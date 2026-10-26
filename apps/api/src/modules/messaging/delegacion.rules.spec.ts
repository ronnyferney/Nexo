import {
  detectarAmpliacionAtribuciones,
  evaluarDelegacion,
  LIMITES_DELEGACION_DEFECTO,
  type LimitesDelegacion,
} from './delegacion.rules';

/** Control de delegación (RF10): reglas puras y deterministas. Son la especificación viva del límite de ciclos/pasos. */
describe('delegacion.rules', () => {
  const limites: LimitesDelegacion = { maxProfundidad: 3, maxConcurrencia: 2, maxPasos: 4 };

  it('permite una delegación dentro de todos los límites', () => {
    const r = evaluarDelegacion(
      { profundidadPadre: 0, cadenaAgentes: ['a'], nuevoAgenteId: 'b', concurrenciaActual: 0, pasosActuales: 0 },
      limites,
    );
    expect(r).toEqual({ permitido: true, profundidadResultante: 1 });
  });

  it('detiene al superar la profundidad máxima (QA10)', () => {
    const r = evaluarDelegacion(
      { profundidadPadre: 3, cadenaAgentes: [], concurrenciaActual: 0, pasosActuales: 0 },
      limites,
    );
    expect(r.permitido).toBe(false);
    expect(r.motivo).toBe('PROFUNDIDAD_EXCEDIDA');
    expect(r.profundidadResultante).toBe(4);
  });

  it('detecta un ciclo cuando el receptor ya está en la cadena ascendente (QA10)', () => {
    const r = evaluarDelegacion(
      { profundidadPadre: 1, cadenaAgentes: ['a', 'b'], nuevoAgenteId: 'a', concurrenciaActual: 0, pasosActuales: 0 },
      limites,
    );
    expect(r.permitido).toBe(false);
    expect(r.motivo).toBe('CICLO_DETECTADO');
  });

  it('detiene al alcanzar la concurrencia máxima por proceso', () => {
    const r = evaluarDelegacion(
      { profundidadPadre: 0, cadenaAgentes: [], nuevoAgenteId: 'b', concurrenciaActual: 2, pasosActuales: 0 },
      limites,
    );
    expect(r).toMatchObject({ permitido: false, motivo: 'CONCURRENCIA_EXCEDIDA' });
  });

  it('detiene al alcanzar el nº de pasos del proceso (prevención de ruido/ciclos)', () => {
    const r = evaluarDelegacion(
      { profundidadPadre: 0, cadenaAgentes: [], nuevoAgenteId: 'b', concurrenciaActual: 0, pasosActuales: 4 },
      limites,
    );
    expect(r).toMatchObject({ permitido: false, motivo: 'PASOS_EXCEDIDOS' });
  });

  it('la profundidad se evalúa antes que el ciclo (motivo determinista)', () => {
    const r = evaluarDelegacion(
      { profundidadPadre: 3, cadenaAgentes: ['a'], nuevoAgenteId: 'a', concurrenciaActual: 9, pasosActuales: 9 },
      limites,
    );
    expect(r.motivo).toBe('PROFUNDIDAD_EXCEDIDA');
  });

  describe('reglas duras (RF10): un mensaje/instrucción no amplía atribuciones', () => {
    it('rechaza crear agentes productivos', () => {
      expect(detectarAmpliacionAtribuciones({ crearAgentes: true })).toBe('AGENTE_NO_CREA_AGENTES');
      expect(detectarAmpliacionAtribuciones({ spawnAgents: true })).toBe('AGENTE_NO_CREA_AGENTES');
    });

    it('rechaza la autoaprobación de su propia excepción', () => {
      expect(detectarAmpliacionAtribuciones({ autoAprobar: true })).toBe('NO_AUTOAPROBACION');
    });

    it('rechaza ampliar el presupuesto por instrucción generada', () => {
      expect(detectarAmpliacionAtribuciones({ ampliarPresupuesto: true })).toBe('NO_AMPLIA_PRESUPUESTO');
      expect(detectarAmpliacionAtribuciones({ presupuestoExtraUsd: 10 })).toBe('NO_AMPLIA_PRESUPUESTO');
    });

    it('acepta un alcance inocuo (no amplía nada)', () => {
      expect(detectarAmpliacionAtribuciones({ leer: ['evidencia-1'], scope: 'read' })).toBeNull();
      expect(detectarAmpliacionAtribuciones(null)).toBeNull();
      expect(detectarAmpliacionAtribuciones('texto')).toBeNull();
    });
  });

  it('los límites por defecto son conservadores y positivos', () => {
    expect(LIMITES_DELEGACION_DEFECTO.maxProfundidad).toBeGreaterThan(0);
    expect(LIMITES_DELEGACION_DEFECTO.maxConcurrencia).toBeGreaterThan(0);
    expect(LIMITES_DELEGACION_DEFECTO.maxPasos).toBeGreaterThan(0);
  });
});
