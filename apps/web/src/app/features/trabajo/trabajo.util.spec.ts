import type { ContratoResumen, EstadoResultado, EstadoTarea, Tarea } from '../../core/results.models';
import {
  avancesResultado,
  contratoEditable,
  esMiTarea,
  estadoResultadoMeta,
  estadoTareaMeta,
  ordenarPorUrgencia,
  prioridadBadge,
  puedeCompletarTarea,
  puedeComprometer,
  puedeValidar,
  resultadoAceptado,
  resultadoGeneradoNoAceptado,
  siguientePaso,
  tareaTerminal,
  tareaVencida,
  transicionesTarea,
  urgenciaScore,
} from './trabajo.util';

function tarea(partial: Partial<Tarea> = {}): Tarea {
  return {
    id: partial.id ?? 't1',
    workspaceId: 'w1',
    orgUnitId: null,
    objetivoId: null,
    titulo: partial.titulo ?? 'Tarea',
    descripcion: null,
    criterioAceptacion: null,
    entradas: {},
    responsableAgentId: partial.responsableAgentId ?? null,
    equipoId: null,
    duenoUserId: partial.duenoUserId ?? null,
    prioridad: partial.prioridad ?? 3,
    fechaLimite: partial.fechaLimite ?? null,
    estado: partial.estado ?? 'PENDIENTE',
    tipoResultado: partial.tipoResultado ?? 'PRODUCTO_INTERMEDIO',
    parentTareaId: null,
    profundidadDelegacion: 0,
    correlationId: null,
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    contratoResultado: partial.contratoResultado ?? null,
  };
}

const contrato = (estado: EstadoResultado): ContratoResumen => ({ id: 'c1', estado, tipoResultado: 'RESULTADO_NEGOCIO' });

describe('trabajo.util', () => {
  describe('mapeo de estados', () => {
    it('da etiqueta y color para cada estado de tarea y de resultado', () => {
      const estadosTarea: EstadoTarea[] = [
        'PENDIENTE',
        'EN_EJECUCION',
        'ESPERANDO_APROBACION',
        'BLOQUEADA',
        'EN_REVISION',
        'COMPLETADA',
        'FALLIDA_CANCELADA',
      ];
      for (const e of estadosTarea) expect(estadoTareaMeta(e).label.length).toBeGreaterThan(0);
      expect(estadoTareaMeta('COMPLETADA').badge).toBe('success');
      expect(estadoResultadoMeta('ACEPTADO').badge).toBe('success');
      expect(estadoResultadoMeta('DEVUELTO_INCUMPLIDO').badge).toBe('danger');
    });
  });

  describe('resultado generado vs aceptado (HU15)', () => {
    it('distingue aceptado de solo generado', () => {
      expect(resultadoAceptado('ACEPTADO')).toBe(true);
      expect(resultadoAceptado('PENDIENTE_VALIDACION')).toBe(false);
      expect(resultadoAceptado(null)).toBe(false);
      expect(resultadoGeneradoNoAceptado('EN_PRODUCCION')).toBe(true);
      expect(resultadoGeneradoNoAceptado('PENDIENTE_VALIDACION')).toBe(true);
      expect(resultadoGeneradoNoAceptado('ACEPTADO')).toBe(false);
      expect(resultadoGeneradoNoAceptado('PROPUESTO')).toBe(false);
    });
  });

  describe('transiciones de tarea', () => {
    it('espeja las transiciones del backend', () => {
      expect(transicionesTarea('PENDIENTE')).toEqual(['EN_EJECUCION', 'BLOQUEADA', 'FALLIDA_CANCELADA']);
      expect(transicionesTarea('COMPLETADA')).toEqual([]);
      expect(tareaTerminal('COMPLETADA')).toBe(true);
      expect(tareaTerminal('FALLIDA_CANCELADA')).toBe(true);
      expect(tareaTerminal('PENDIENTE')).toBe(false);
    });

    it('completar exige resultado ACEPTADO (guarda dura HU15/QA09)', () => {
      expect(puedeCompletarTarea('EN_EJECUCION', contrato('ACEPTADO'))).toBe(true);
      // Resultado solo generado, no aceptado: no se puede completar.
      expect(puedeCompletarTarea('EN_EJECUCION', contrato('PENDIENTE_VALIDACION'))).toBe(false);
      // Sin contrato tampoco.
      expect(puedeCompletarTarea('EN_EJECUCION', null)).toBe(false);
      // Desde un estado que no transiciona a COMPLETADA, aunque el resultado esté aceptado.
      expect(puedeCompletarTarea('PENDIENTE', contrato('ACEPTADO'))).toBe(false);
    });
  });

  describe('acciones del contrato de resultado', () => {
    it('comprometer solo desde PROPUESTO; editable solo en PROPUESTO', () => {
      expect(puedeComprometer('PROPUESTO')).toBe(true);
      expect(puedeComprometer('COMPROMETIDO')).toBe(false);
      expect(contratoEditable('PROPUESTO')).toBe(true);
      expect(contratoEditable('COMPROMETIDO')).toBe(false);
    });

    it('avances ofrecidos por estado', () => {
      expect(avancesResultado('COMPROMETIDO')).toEqual(['EN_PRODUCCION']);
      expect(avancesResultado('EN_PRODUCCION')).toEqual(['PENDIENTE_VALIDACION']);
      expect(avancesResultado('PENDIENTE_VALIDACION')).toEqual(['EN_PRODUCCION']);
      expect(avancesResultado('DEVUELTO_INCUMPLIDO')).toEqual(['EN_PRODUCCION']);
      expect(avancesResultado('ACEPTADO')).toEqual([]);
      // PROPUESTO solo comprometer, no avanza.
      expect(avancesResultado('PROPUESTO')).toEqual([]);
    });

    it('validar solo en PENDIENTE_VALIDACION', () => {
      expect(puedeValidar('PENDIENTE_VALIDACION')).toBe(true);
      expect(puedeValidar('EN_PRODUCCION')).toBe(false);
    });
  });

  describe('siguientePaso', () => {
    it('describe qué falta según estado operativo y de resultado', () => {
      expect(siguientePaso(tarea({ estado: 'COMPLETADA' }))).toBe('Tarea completada');
      expect(siguientePaso(tarea({ estado: 'BLOQUEADA' }))).toContain('bloqueo');
      expect(siguientePaso(tarea({ estado: 'EN_EJECUCION', contratoResultado: null }))).toContain('contrato');
      expect(siguientePaso(tarea({ estado: 'EN_EJECUCION', contratoResultado: contrato('PROPUESTO') }))).toContain(
        'Comprometer',
      );
      expect(siguientePaso(tarea({ estado: 'EN_EJECUCION', contratoResultado: contrato('PENDIENTE_VALIDACION') }))).toContain(
        'Verificar',
      );
      expect(siguientePaso(tarea({ estado: 'EN_EJECUCION', contratoResultado: contrato('ACEPTADO') }))).toContain(
        'completar',
      );
    });
  });

  describe('urgencia y vencimiento', () => {
    const ahora = Date.parse('2026-10-26T12:00:00.000Z');

    it('detecta tareas vencidas (fecha pasada y no terminal)', () => {
      expect(tareaVencida(tarea({ fechaLimite: '2026-10-25T12:00:00.000Z' }), ahora)).toBe(true);
      expect(tareaVencida(tarea({ fechaLimite: '2026-10-27T12:00:00.000Z' }), ahora)).toBe(false);
      expect(tareaVencida(tarea({ fechaLimite: null }), ahora)).toBe(false);
      // Terminal no se considera vencida aunque la fecha pasó.
      expect(tareaVencida(tarea({ estado: 'COMPLETADA', fechaLimite: '2026-01-01T00:00:00.000Z' }), ahora)).toBe(false);
    });

    it('ordena vencidas primero, luego por fecha, prioridad, y sin-fecha y terminales al final', () => {
      const vencida = tarea({ id: 'vencida', fechaLimite: '2026-10-25T12:00:00.000Z' });
      const prontas = tarea({ id: 'pronta', fechaLimite: '2026-10-27T12:00:00.000Z' });
      const lejana = tarea({ id: 'lejana', fechaLimite: '2026-12-01T12:00:00.000Z' });
      const sinFecha = tarea({ id: 'sinfecha', fechaLimite: null, prioridad: 1 });
      const completada = tarea({ id: 'done', estado: 'COMPLETADA', fechaLimite: '2026-10-20T12:00:00.000Z' });
      const orden = [lejana, completada, sinFecha, vencida, prontas].sort((a, b) => ordenarPorUrgencia(a, b, ahora));
      expect(orden.map((t) => t.id)).toEqual(['vencida', 'pronta', 'lejana', 'sinfecha', 'done']);
    });

    it('a igual fecha, la mayor prioridad (1) es más urgente', () => {
      const alta = tarea({ fechaLimite: '2026-10-27T12:00:00.000Z', prioridad: 1 });
      const baja = tarea({ fechaLimite: '2026-10-27T12:00:00.000Z', prioridad: 5 });
      expect(urgenciaScore(alta, ahora)).toBeLessThan(urgenciaScore(baja, ahora));
    });

    it('prioridadBadge destaca 1 y 2', () => {
      expect(prioridadBadge(1)).toBe('danger');
      expect(prioridadBadge(2)).toBe('warning');
      expect(prioridadBadge(3)).toBe('');
    });
  });

  describe('esMiTarea', () => {
    it('es mía si soy el dueño humano o el ejecutor es uno de mis agentes', () => {
      const misAgentes = new Set(['a1', 'a2']);
      expect(esMiTarea(tarea({ duenoUserId: 'u1' }), 'u1', misAgentes)).toBe(true);
      expect(esMiTarea(tarea({ duenoUserId: 'u2' }), 'u1', misAgentes)).toBe(false);
      expect(esMiTarea(tarea({ responsableAgentId: 'a2' }), 'u1', misAgentes)).toBe(true);
      expect(esMiTarea(tarea({ responsableAgentId: 'a9' }), 'u1', misAgentes)).toBe(false);
      expect(esMiTarea(tarea({ responsableAgentId: 'a1' }), null, ['a1'])).toBe(true);
    });
  });
});
