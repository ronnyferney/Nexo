import type { ContratoTransferencia, MensajeAgente } from '../../core/messaging.models';
import {
  accionesMensaje,
  agruparPorConversacion,
  autorTipo,
  estadoMensaje,
  estadoMensajeMeta,
  ordenarPorReciente,
  ordenarSegmentos,
  prioridadMensajeBadge,
  puedeDecidirTransferencia,
  tipoCanalMeta,
  tipoMensajeMeta,
} from './mensajes.util';

function mensaje(partial: Partial<MensajeAgente> = {}): MensajeAgente {
  return {
    id: partial.id ?? 'm1',
    workspaceId: 'w1',
    empresaId: null,
    messageId: partial.messageId ?? 'mid-1',
    correlationId: partial.correlationId ?? null,
    emisorAgentId: partial.emisorAgentId ?? null,
    destinatarioAgentId: partial.destinatarioAgentId ?? null,
    destinatarioEquipoId: null,
    canalId: null,
    misionId: null,
    tareaId: partial.tareaId ?? null,
    tipo: partial.tipo ?? 'ASIGNACION',
    prioridad: partial.prioridad ?? 3,
    version: 1,
    fechaLimite: partial.fechaLimite ?? null,
    referencias: [],
    permisos: {},
    enviadoAt: partial.enviadoAt ?? '2026-01-01T00:00:00.000Z',
    recibidoAt: partial.recibidoAt ?? null,
    aceptadoAt: partial.aceptadoAt ?? null,
    resueltoAt: partial.resueltoAt ?? null,
    motivo: partial.motivo ?? null,
    recibidoPorAgentId: null,
    aceptadoPorAgentId: null,
    createdAt: partial.enviadoAt ?? '2026-01-01T00:00:00.000Z',
  };
}

function transferencia(partial: Partial<ContratoTransferencia> = {}): ContratoTransferencia {
  return {
    id: partial.id ?? 'tr1',
    workspaceId: 'w1',
    tareaId: 't1',
    secuenciaSegmento: partial.secuenciaSegmento ?? 1,
    fromAgentId: partial.fromAgentId ?? null,
    toAgentId: partial.toAgentId ?? null,
    toEquipoId: null,
    estadoAlcanzado: {},
    entregableParcial: null,
    contextoAutorizado: [],
    criterioSiguiente: null,
    permisos: {},
    responsableEntranteUserId: null,
    workflowId: null,
    estado: partial.estado ?? 'PROPUESTO',
    motivoRechazo: null,
    mensajeId: null,
    executionId: null,
    profundidadDelegacion: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    decididoAt: null,
  };
}

describe('mensajes.util', () => {
  describe('estadoMensaje', () => {
    it('deriva el estado del hecho más avanzado alcanzado', () => {
      expect(estadoMensaje(mensaje())).toBe('ENVIADO');
      expect(estadoMensaje(mensaje({ recibidoAt: '2026-01-01T01:00:00.000Z' }))).toBe('RECIBIDO');
      expect(
        estadoMensaje(mensaje({ recibidoAt: '2026-01-01T01:00:00.000Z', aceptadoAt: '2026-01-01T02:00:00.000Z' })),
      ).toBe('ACEPTADO');
      expect(estadoMensaje(mensaje({ resueltoAt: '2026-01-01T03:00:00.000Z' }))).toBe('RESUELTO');
    });

    it('resuelto gana aunque falten hechos intermedios', () => {
      expect(estadoMensaje(mensaje({ aceptadoAt: null, resueltoAt: '2026-01-02T00:00:00.000Z' }))).toBe('RESUELTO');
      expect(estadoMensajeMeta(mensaje({ resueltoAt: '2026-01-02T00:00:00.000Z' })).badge).toBe('success');
    });
  });

  describe('autorTipo', () => {
    it('distingue digital, humano y sistema', () => {
      expect(autorTipo('ag1', null)).toBe('digital');
      expect(autorTipo(null, 'u1')).toBe('humano');
      expect(autorTipo(null, null)).toBe('sistema');
      // El agente tiene prioridad sobre la persona (actor digital explícito).
      expect(autorTipo('ag1', 'u1')).toBe('digital');
    });
  });

  describe('accionesMensaje', () => {
    it('ofrece solo los hechos aún no marcados', () => {
      const a = accionesMensaje(mensaje());
      expect(a).toEqual({ recibir: true, aceptar: true, resolver: true, motivoRequeridoAlResolver: false });
    });

    it('oculta los hechos ya ocurridos (idempotencia)', () => {
      const a = accionesMensaje(mensaje({ recibidoAt: '2026-01-01T01:00:00.000Z', resueltoAt: '2026-01-01T02:00:00.000Z' }));
      expect(a.recibir).toBe(false);
      expect(a.resolver).toBe(false);
      expect(a.aceptar).toBe(true);
    });

    it('exige motivo al resolver una DEVOLUCION (HU14)', () => {
      expect(accionesMensaje(mensaje({ tipo: 'DEVOLUCION' })).motivoRequeridoAlResolver).toBe(true);
      expect(accionesMensaje(mensaje({ tipo: 'ENTREGA' })).motivoRequeridoAlResolver).toBe(false);
    });
  });

  describe('agruparPorConversacion', () => {
    it('agrupa por correlationId y ordena cada hilo cronológicamente', () => {
      const m1 = mensaje({ id: 'a', correlationId: 'c1', enviadoAt: '2026-01-01T00:00:00.000Z' });
      const m2 = mensaje({ id: 'b', correlationId: 'c1', enviadoAt: '2026-01-02T00:00:00.000Z' });
      const grupos = agruparPorConversacion([m2, m1]);
      expect(grupos.length).toBe(1);
      expect(grupos[0].mensajes.map((m) => m.id)).toEqual(['a', 'b']);
      expect(grupos[0].ultimo.id).toBe('b');
    });

    it('deja los mensajes sin correlación en grupos propios y ordena los grupos por el más reciente', () => {
      const viejo = mensaje({ id: 'x', correlationId: null, enviadoAt: '2026-01-01T00:00:00.000Z' });
      const nuevo = mensaje({ id: 'y', correlationId: 'c2', enviadoAt: '2026-01-05T00:00:00.000Z' });
      const grupos = agruparPorConversacion([viejo, nuevo]);
      expect(grupos.length).toBe(2);
      expect(grupos[0].ultimo.id).toBe('y');
    });
  });

  describe('orden y prioridad', () => {
    it('ordenarPorReciente pone el más nuevo primero', () => {
      const a = mensaje({ id: 'a', enviadoAt: '2026-01-01T00:00:00.000Z' });
      const b = mensaje({ id: 'b', enviadoAt: '2026-01-02T00:00:00.000Z' });
      expect([a, b].sort(ordenarPorReciente).map((m) => m.id)).toEqual(['b', 'a']);
    });

    it('prioridadMensajeBadge destaca 1 y 2', () => {
      expect(prioridadMensajeBadge(1)).toBe('danger');
      expect(prioridadMensajeBadge(2)).toBe('warning');
      expect(prioridadMensajeBadge(3)).toBe('');
    });
  });

  describe('handoff', () => {
    it('solo una transferencia PROPUESTA se puede decidir', () => {
      expect(puedeDecidirTransferencia(transferencia({ estado: 'PROPUESTO' }))).toBe(true);
      expect(puedeDecidirTransferencia(transferencia({ estado: 'ACEPTADO' }))).toBe(false);
      expect(puedeDecidirTransferencia(transferencia({ estado: 'RECHAZADO' }))).toBe(false);
    });

    it('ordenarSegmentos arma la cadena por secuencia ascendente sin mutar el arreglo', () => {
      const s2 = transferencia({ id: 's2', secuenciaSegmento: 2 });
      const s1 = transferencia({ id: 's1', secuenciaSegmento: 1 });
      const entrada = [s2, s1];
      const salida = ordenarSegmentos(entrada);
      expect(salida.map((s) => s.id)).toEqual(['s1', 's2']);
      expect(entrada.map((s) => s.id)).toEqual(['s2', 's1']);
    });
  });

  describe('mapas de metadatos', () => {
    it('cada tipo de mensaje tiene etiqueta e ícono', () => {
      expect(tipoMensajeMeta('HANDOFF').icon).toBe('shuffle');
      expect(tipoMensajeMeta('BLOQUEO').badge).toBe('danger');
    });

    it('cada tipo de canal tiene etiqueta e ícono', () => {
      expect(tipoCanalMeta('MISION').icon).toBe('target');
      expect(tipoCanalMeta('AREA').label).toBe('Área');
    });
  });
});
