import type { NivelJerarquico } from '@prisma/client';
import {
  ACCIONES_BAJO_IMPACTO,
  type AccionCoordinador,
  CAMPOS_SUPERVISION_PERMITIDOS,
  clasificarBloqueo,
  clasificarCompromiso,
  delegacionPermitida,
  evaluarCambioPresupuesto,
  type OrdenCoordinacion,
  proyectarSupervision,
  requiereAprobacionHumana,
  resolverContradiccion,
  supervisionTransversalValida,
  validarAprobacion,
} from './mission.governance';

/**
 * Pruebas AISLADAS (TS puro, sin Nest/BD/Redis) del gobierno del coordinador de misiones transversales (ADR 0016 ·
 * Incremento 3). Validan la LÓGICA de diseño sin cablear nada al runtime: no se conecta al servicio ni se ejecuta
 * ninguna acción con efecto. Sandbox, sin datos reales, sin gasto.
 */
describe('mission.governance · gobierno puro del coordinador (ADR 0016 Inc.3 · diseño, no operativo)', () => {
  describe('requiereAprobacionHumana · qué exige autorización humana (E6)', () => {
    const altoImpacto: AccionCoordinador[] = [
      'AUTORIZAR_MISION',
      'DETENER_MISION',
      'CANCELAR_MISION',
      'MARCAR_LOGRADA',
      'APLICAR_RECOMENDACION_SUPERVISION',
      'SUSPENDER_AGENTE',
      'REACTIVAR_AGENTE',
      'SUSPENDER_COORDINADOR',
      'REASIGNAR_TAREA',
      'REASIGNAR_COORDINACION',
      'MOVER_PRESUPUESTO',
      'LANZAR_ACCION_EXTERNA',
      'RESOLVER_CONTRADICCION',
    ];

    it('marca como requiere-aprobación toda acción de alto impacto o irreversible', () => {
      for (const a of altoImpacto) expect(requiereAprobacionHumana(a)).toBe(true);
    });

    it('no exige aprobación para lectura/correlación/notificación/freno que el coordinador sí ejecuta', () => {
      for (const a of ACCIONES_BAJO_IMPACTO) expect(requiereAprobacionHumana(a)).toBe(false);
    });

    it('recomendar una corrección NO requiere aprobación, pero APLICARLA sí (recomendación != ejecución)', () => {
      expect(requiereAprobacionHumana('RECOMENDAR_CORRECCION')).toBe(false);
      expect(requiereAprobacionHumana('APLICAR_RECOMENDACION_SUPERVISION')).toBe(true);
    });

    it('bajo impacto y alto impacto son conjuntos disjuntos', () => {
      for (const a of ACCIONES_BAJO_IMPACTO) expect(requiereAprobacionHumana(a)).toBe(false);
    });
  });

  describe('validarAprobacion · no autoaprobación (QA13) y "solo humano aprueba lo de alto impacto"', () => {
    it('el coordinador (agente) NO puede aprobar su propia acción de alto impacto', () => {
      const r = validarAprobacion({
        accion: 'MOVER_PRESUPUESTO',
        solicitanteId: 'agent-super',
        solicitanteTipo: 'AGENTE',
        aprobadorId: 'agent-super',
        aprobadorTipo: 'AGENTE',
      });
      expect(r.valida).toBe(false);
      expect(r.motivo).toBe('COORDINADOR_NO_SE_AUTOAPRUEBA');
    });

    it('un agente distinto tampoco aprueba una acción de alto impacto (debe ser humano)', () => {
      const r = validarAprobacion({
        accion: 'SUSPENDER_AGENTE',
        solicitanteId: 'agent-super',
        solicitanteTipo: 'AGENTE',
        aprobadorId: 'agent-otro',
        aprobadorTipo: 'AGENTE',
      });
      expect(r.valida).toBe(false);
      expect(r.motivo).toBe('APROBADOR_DEBE_SER_HUMANO');
    });

    it('un humano NO puede aprobar su propia solicitud (no autoaprobación, aunque sea humano)', () => {
      const r = validarAprobacion({
        accion: 'CANCELAR_MISION',
        solicitanteId: 'user-1',
        solicitanteTipo: 'HUMANO',
        aprobadorId: 'user-1',
        aprobadorTipo: 'HUMANO',
      });
      expect(r.valida).toBe(false);
      expect(r.motivo).toBe('AUTOAPROBACION_PROHIBIDA');
    });

    it('una aprobación de un humano distinto, para una acción de alto impacto, es válida', () => {
      const r = validarAprobacion({
        accion: 'APLICAR_RECOMENDACION_SUPERVISION',
        solicitanteId: 'agent-super',
        solicitanteTipo: 'AGENTE',
        aprobadorId: 'user-jefe',
        aprobadorTipo: 'HUMANO',
      });
      expect(r.valida).toBe(true);
      expect(r.motivo).toBeNull();
    });

    it('una acción de bajo impacto no se "aprueba" por esta vía (evita habilitar efectos sin clasificar)', () => {
      const r = validarAprobacion({
        accion: 'SEGUIMIENTO',
        solicitanteId: 'agent-super',
        solicitanteTipo: 'AGENTE',
        aprobadorId: 'user-jefe',
        aprobadorTipo: 'HUMANO',
      });
      expect(r.valida).toBe(false);
      expect(r.motivo).toBe('NO_REQUIERE_APROBACION');
    });
  });

  describe('delegacionPermitida · solo subconjuntos (ADR 0014/E5), nunca amplía', () => {
    it('permite delegar un subconjunto estricto de los permisos del delegante', () => {
      const r = delegacionPermitida(['crm:read', 'crm:write', 'mail:send'], ['crm:read']);
      expect(r.permitida).toBe(true);
      expect(r.concedidos).toEqual(['crm:read']);
      expect(r.excedentes).toEqual([]);
    });

    it('NO permite ampliar: los permisos que el delegante no posee quedan como excedentes y no se conceden', () => {
      const r = delegacionPermitida(['crm:read'], ['crm:read', 'crm:write', 'admin:all']);
      expect(r.permitida).toBe(false);
      expect(r.concedidos).toEqual(['crm:read']);
      expect(r.excedentes).toEqual(['crm:write', 'admin:all']);
    });

    it('los concedidos son siempre un subconjunto de los del delegante (invariante)', () => {
      const delegante = ['a', 'b', 'c'];
      const r = delegacionPermitida(delegante, ['b', 'z', 'c', 'y']);
      for (const p of r.concedidos) expect(delegante).toContain(p);
    });

    it('ignora duplicados en la solicitud sin alterar el resultado', () => {
      const r = delegacionPermitida(['a', 'b'], ['a', 'a', 'b', 'b']);
      expect(r.concedidos).toEqual(['a', 'b']);
      expect(r.permitida).toBe(true);
    });

    it('un delegante sin permisos no puede conceder nada', () => {
      const r = delegacionPermitida([], ['a']);
      expect(r.permitida).toBe(false);
      expect(r.concedidos).toEqual([]);
      expect(r.excedentes).toEqual(['a']);
    });
  });

  describe('evaluarCambioPresupuesto · el coordinador no amplía ni mueve presupuesto (RF40/QA13)', () => {
    it('toda ampliación exige aprobación humana, venga de quien venga', () => {
      const r = evaluarCambioPresupuesto({ origenCoordinador: false, montoActual: 100, montoSolicitado: 150 });
      expect(r.aplicableSinAprobacion).toBe(false);
      expect(r.requiereAprobacionHumana).toBe(true);
      expect(r.motivo).toBe('AMPLIACION_REQUIERE_APROBACION');
    });

    it('un movimiento originado por el coordinador exige aprobación aunque no amplíe', () => {
      const r = evaluarCambioPresupuesto({ origenCoordinador: true, montoActual: 100, montoSolicitado: 100 });
      expect(r.aplicableSinAprobacion).toBe(false);
      expect(r.requiereAprobacionHumana).toBe(true);
      expect(r.motivo).toBe('ORIGEN_COORDINADOR_REQUIERE_APROBACION');
    });

    it('el coordinador NO puede autoampliarse presupuesto (ampliación + origen coordinador)', () => {
      const r = evaluarCambioPresupuesto({ origenCoordinador: true, montoActual: 100, montoSolicitado: 500 });
      expect(r.requiereAprobacionHumana).toBe(true);
      expect(r.aplicableSinAprobacion).toBe(false);
    });

    it('una no-ampliación de origen humano puede aplicarse sin aprobación', () => {
      const r = evaluarCambioPresupuesto({ origenCoordinador: false, montoActual: 100, montoSolicitado: 80 });
      expect(r.aplicableSinAprobacion).toBe(true);
      expect(r.requiereAprobacionHumana).toBe(false);
      expect(r.motivo).toBe('SIN_CAMBIO');
    });
  });

  describe('clasificarCompromiso · read-model de seguimiento (Inc.3)', () => {
    const PLAZO = 1_000_000;
    it('CUMPLIDO si fue entregado, sin importar el plazo', () => {
      expect(clasificarCompromiso({ plazoMs: PLAZO, ahoraMs: PLAZO + 999, entregado: true })).toBe('CUMPLIDO');
    });
    it('VENCIDO si no se entregó y el plazo ya pasó', () => {
      expect(clasificarCompromiso({ plazoMs: PLAZO, ahoraMs: PLAZO + 1, entregado: false })).toBe('VENCIDO');
    });
    it('EN_RIESGO si no se entregó, no venció y está dentro de la ventana de riesgo', () => {
      const r = clasificarCompromiso({
        plazoMs: PLAZO,
        ahoraMs: PLAZO - 100,
        entregado: false,
        ventanaRiesgoMs: 200,
      });
      expect(r).toBe('EN_RIESGO');
    });
    it('EN_CURSO si no se entregó y hay holgura mayor que la ventana de riesgo', () => {
      const r = clasificarCompromiso({
        plazoMs: PLAZO,
        ahoraMs: PLAZO - 1000,
        entregado: false,
        ventanaRiesgoMs: 200,
      });
      expect(r).toBe('EN_CURSO');
    });
    it('sin ventana de riesgo configurada, solo distingue EN_CURSO/VENCIDO', () => {
      expect(clasificarCompromiso({ plazoMs: PLAZO, ahoraMs: PLAZO - 1, entregado: false })).toBe('EN_CURSO');
    });
  });

  describe('clasificarBloqueo · severidad y escalamiento (Inc.3/QA10)', () => {
    it('una contradicción de autoridad es ALTA y SIEMPRE exige decisión humana', () => {
      const r = clasificarBloqueo({
        origen: 'CONTRADICCION_AUTORIDAD',
        frenaResultadoNegocio: false,
        sinReglaInequivoca: false,
      });
      expect(r.severidad).toBe('ALTA');
      expect(r.requiereDecisionHumana).toBe(true);
    });
    it('cualquier bloqueo sin regla inequívoca exige decisión humana', () => {
      const r = clasificarBloqueo({ origen: 'INCUMPLIMIENTO', frenaResultadoNegocio: false, sinReglaInequivoca: true });
      expect(r.requiereDecisionHumana).toBe(true);
    });
    it('frenar un resultado de negocio sube la severidad a ALTA', () => {
      const r = clasificarBloqueo({
        origen: 'DEPENDENCIA_VENCIDA',
        frenaResultadoNegocio: true,
        sinReglaInequivoca: false,
      });
      expect(r.severidad).toBe('ALTA');
    });
    it('una dependencia vencida interna con regla clara es MEDIA y no exige decisión humana', () => {
      const r = clasificarBloqueo({
        origen: 'DEPENDENCIA_VENCIDA',
        frenaResultadoNegocio: false,
        sinReglaInequivoca: false,
      });
      expect(r.severidad).toBe('MEDIA');
      expect(r.requiereDecisionHumana).toBe(false);
    });
  });

  describe('proyectarSupervision · supervisar NO concede acceso a datos (ADR 0007)', () => {
    it('descarta cualquier campo fuera de la lista blanca de metadatos', () => {
      const vista = {
        compromisosVencidos: 2,
        latenciaMs: 1200,
        // Campos sensibles que NO debe exponer la supervisión:
        contenidoMensajes: 'secreto',
        credenciales: 'token-xyz',
        datosCliente: { nombre: 'ACME' },
      };
      const salida = proyectarSupervision(vista);
      expect(salida).toEqual({ compromisosVencidos: 2, latenciaMs: 1200 });
      expect(salida['contenidoMensajes']).toBeUndefined();
      expect(salida['credenciales']).toBeUndefined();
      expect(salida['datosCliente']).toBeUndefined();
    });
    it('solo expone los campos declarados permitidos', () => {
      const vista: Record<string, unknown> = {};
      for (const c of CAMPOS_SUPERVISION_PERMITIDOS) vista[c] = 1;
      vista['otroCampo'] = 'x';
      const salida = proyectarSupervision(vista);
      expect(Object.keys(salida).sort()).toEqual([...CAMPOS_SUPERVISION_PERMITIDOS].sort());
    });
  });

  describe('resolverContradiccion · autoridad → prioridad → versión, o detener y escalar (QA10)', () => {
    function orden(p: Partial<OrdenCoordinacion>): OrdenCoordinacion {
      return { id: 'o', nivelEmisor: 'JEFE', prioridad: 0, version: 1, vigente: true, ...p };
    }

    it('gana la orden de mayor autoridad', () => {
      const r = resolverContradiccion([
        orden({ id: 'baja', nivelEmisor: 'LIDER' }),
        orden({ id: 'alta', nivelEmisor: 'DIRECTOR' }),
      ]);
      expect(r.decision).toBe('ORDEN_GANADORA');
      if (r.decision === 'ORDEN_GANADORA') expect(r.ganadoraId).toBe('alta');
    });

    it('a igual autoridad, desempata la prioridad y luego la versión', () => {
      const r1 = resolverContradiccion([
        orden({ id: 'p1', nivelEmisor: 'JEFE', prioridad: 1 }),
        orden({ id: 'p2', nivelEmisor: 'JEFE', prioridad: 5 }),
      ]);
      if (r1.decision === 'ORDEN_GANADORA') expect(r1.ganadoraId).toBe('p2');

      const r2 = resolverContradiccion([
        orden({ id: 'v1', nivelEmisor: 'JEFE', prioridad: 3, version: 1 }),
        orden({ id: 'v2', nivelEmisor: 'JEFE', prioridad: 3, version: 2 }),
      ]);
      if (r2.decision === 'ORDEN_GANADORA') expect(r2.ganadoraId).toBe('v2');
    });

    it('sin regla inequívoca (empate total) → DETENER y pedir decisión humana', () => {
      const r = resolverContradiccion([
        orden({ id: 'a', nivelEmisor: 'JEFE', prioridad: 2, version: 1 }),
        orden({ id: 'b', nivelEmisor: 'JEFE', prioridad: 2, version: 1 }),
      ]);
      expect(r.decision).toBe('DETENER_Y_ESCALAR');
      expect(r.detener).toBe(true);
      expect(r.requiereDecisionHumana).toBe(true);
    });

    it('sin órdenes vigentes → DETENER y escalar (el coordinador no inventa una decisión)', () => {
      const r = resolverContradiccion([orden({ id: 'x', vigente: false })]);
      expect(r.decision).toBe('DETENER_Y_ESCALAR');
    });

    it('descarta las órdenes no vigentes al resolver', () => {
      const r = resolverContradiccion([
        orden({ id: 'vieja', nivelEmisor: 'GERENTE', vigente: false }),
        orden({ id: 'nueva', nivelEmisor: 'LIDER', vigente: true }),
      ]);
      if (r.decision === 'ORDEN_GANADORA') expect(r.ganadoraId).toBe('nueva');
    });
  });

  describe('supervisionTransversalValida · supervisar no crea ciclos de mando (QA10)', () => {
    it('es válida cuando no cierra un ciclo en el grafo de supervisión', () => {
      const padres = new Map<string, string | null>([
        ['agent-a', null],
        ['agent-b', 'agent-a'],
      ]);
      expect(supervisionTransversalValida('coord', 'agent-b', padres)).toBe(true);
    });

    it('es inválida si el coordinador ya depende (directa o transitivamente) del agente a supervisar', () => {
      // coord -> super-dir ; si coord supervisara a super-dir se cerraría un ciclo.
      const padres = new Map<string, string | null>([
        ['coord', 'super-dir'],
        ['super-dir', null],
      ]);
      expect(supervisionTransversalValida('coord', 'super-dir', padres)).toBe(false);
    });

    it('un agente no se supervisa a sí mismo', () => {
      expect(supervisionTransversalValida('coord', 'coord', new Map())).toBe(false);
    });
  });

  describe('coherencia con el enum de niveles de @prisma/client', () => {
    it('usa niveles válidos de NivelJerarquico en la resolución de autoridad', () => {
      const niveles: NivelJerarquico[] = ['EMPLEADO', 'LIDER', 'JEFE', 'DIRECTOR', 'GERENTE', 'SUPEREMPLEADO'];
      const r = resolverContradiccion(
        niveles.map((n) => ({ id: n, nivelEmisor: n, prioridad: 0, version: 1, vigente: true })),
      );
      // Gana SUPEREMPLEADO, el de mayor autoridad.
      if (r.decision === 'ORDEN_GANADORA') expect(r.ganadoraId).toBe('SUPEREMPLEADO');
    });
  });
});
