import type { EstadoMision } from '@prisma/client';
import {
  cumpleCondicionLograda,
  esEstadoTerminal,
  esTransicionValida,
  estadoOperativoSugerido,
  type ResumenMision,
} from './mission.state';

/** Resumen base sin trabajo vinculado; cada prueba ajusta lo que necesita. */
function resumen(parcial: Partial<ResumenMision> = {}): ResumenMision {
  return {
    totalTareas: 0,
    tareasEnProduccion: 0,
    tareasPresentadas: 0,
    contratosNegocio: 0,
    contratosNegocioAceptados: 0,
    bloqueos: 0,
    ...parcial,
  };
}

describe('mission.state · máquina de estados pura (ADR 0016 D2)', () => {
  describe('transiciones del camino feliz', () => {
    it('acepta PROPUESTA -> AUTORIZADA -> EN_CURSO -> EN_VALIDACION -> LOGRADA', () => {
      const camino: EstadoMision[] = ['PROPUESTA', 'AUTORIZADA', 'EN_CURSO', 'EN_VALIDACION', 'LOGRADA'];
      for (let i = 0; i < camino.length - 1; i++) {
        expect(esTransicionValida(camino[i], camino[i + 1])).toBe(true);
      }
    });
  });

  describe('ramas DETENIDA y CANCELADA', () => {
    it('se puede detener desde AUTORIZADA, EN_CURSO y EN_VALIDACION', () => {
      expect(esTransicionValida('AUTORIZADA', 'DETENIDA')).toBe(true);
      expect(esTransicionValida('EN_CURSO', 'DETENIDA')).toBe(true);
      expect(esTransicionValida('EN_VALIDACION', 'DETENIDA')).toBe(true);
    });

    it('DETENIDA requiere decisión humana: se reanuda o se cancela, pero no salta a LOGRADA', () => {
      expect(esTransicionValida('DETENIDA', 'EN_CURSO')).toBe(true);
      expect(esTransicionValida('DETENIDA', 'AUTORIZADA')).toBe(true);
      expect(esTransicionValida('DETENIDA', 'CANCELADA')).toBe(true);
      expect(esTransicionValida('DETENIDA', 'LOGRADA')).toBe(false);
    });

    it('se puede cancelar desde cualquier estado no terminal', () => {
      const noTerminales: EstadoMision[] = ['PROPUESTA', 'AUTORIZADA', 'EN_CURSO', 'EN_VALIDACION', 'DETENIDA'];
      for (const e of noTerminales) expect(esTransicionValida(e, 'CANCELADA')).toBe(true);
    });
  });

  describe('transiciones inválidas', () => {
    it('no se puede saltar de PROPUESTA directamente a EN_CURSO ni a LOGRADA', () => {
      expect(esTransicionValida('PROPUESTA', 'EN_CURSO')).toBe(false);
      expect(esTransicionValida('PROPUESTA', 'LOGRADA')).toBe(false);
    });

    it('un no-op (mismo estado) no es una transición válida', () => {
      expect(esTransicionValida('AUTORIZADA', 'AUTORIZADA')).toBe(false);
    });

    it('LOGRADA y CANCELADA son terminales (ninguna salida)', () => {
      expect(esEstadoTerminal('LOGRADA')).toBe(true);
      expect(esEstadoTerminal('CANCELADA')).toBe(true);
      const todos: EstadoMision[] = [
        'PROPUESTA',
        'AUTORIZADA',
        'EN_CURSO',
        'EN_VALIDACION',
        'LOGRADA',
        'DETENIDA',
        'CANCELADA',
      ];
      for (const destino of todos) {
        expect(esTransicionValida('LOGRADA', destino)).toBe(false);
        expect(esTransicionValida('CANCELADA', destino)).toBe(false);
      }
    });

    it('una misma CANCELADA no se reabre a AUTORIZADA', () => {
      expect(esTransicionValida('CANCELADA', 'AUTORIZADA')).toBe(false);
    });
  });

  describe('estadoOperativoSugerido (avance observado)', () => {
    it('respeta PROPUESTA, DETENIDA y estados terminales sin avanzarlos', () => {
      expect(estadoOperativoSugerido('PROPUESTA', resumen({ tareasEnProduccion: 3 }))).toBe('PROPUESTA');
      expect(estadoOperativoSugerido('DETENIDA', resumen({ tareasEnProduccion: 3 }))).toBe('DETENIDA');
      expect(estadoOperativoSugerido('LOGRADA', resumen())).toBe('LOGRADA');
    });

    it('propone EN_CURSO cuando hay trabajo en producción tras autorizar', () => {
      expect(estadoOperativoSugerido('AUTORIZADA', resumen({ totalTareas: 2, tareasEnProduccion: 1 }))).toBe(
        'EN_CURSO',
      );
    });

    it('propone EN_VALIDACION cuando TODAS las tareas vinculadas están presentadas', () => {
      const r = resumen({ totalTareas: 2, tareasPresentadas: 2, tareasEnProduccion: 0 });
      expect(estadoOperativoSugerido('EN_CURSO', r)).toBe('EN_VALIDACION');
    });

    it('no propone EN_VALIDACION si falta alguna tarea por presentar', () => {
      const r = resumen({ totalTareas: 2, tareasPresentadas: 1, tareasEnProduccion: 1 });
      expect(estadoOperativoSugerido('EN_CURSO', r)).toBe('EN_CURSO');
    });
  });

  describe('cumpleCondicionLograda (ADR 0016 D2)', () => {
    it('exige al menos un contrato de negocio vinculado', () => {
      expect(cumpleCondicionLograda(resumen({ contratosNegocio: 0 }), true)).toBe(false);
    });

    it('exige que TODOS los contratos de negocio estén ACEPTADO', () => {
      expect(cumpleCondicionLograda(resumen({ contratosNegocio: 3, contratosNegocioAceptados: 2 }), true)).toBe(false);
      expect(cumpleCondicionLograda(resumen({ contratosNegocio: 3, contratosNegocioAceptados: 3 }), true)).toBe(true);
    });

    it('sin confirmación humana del dueño no se puede lograr aunque los contratos estén aceptados (D5)', () => {
      expect(cumpleCondicionLograda(resumen({ contratosNegocio: 1, contratosNegocioAceptados: 1 }), false)).toBe(false);
    });
  });
});
