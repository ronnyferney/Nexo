import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import { MissionCoordinatorGovernanceService } from './mission-coordinator-governance.service';

/**
 * Cableado GATED del gobierno del coordinador (ADR 0016 · Inc.3 · compuerta E-B). Prueba aislada con Prisma/Audit
 * SIMULADOS: verifica que, con el flag APAGADO, no hay ningún efecto; y que, con el flag encendido, se respetan QA13
 * (no autoaprobación / no ampliar-mover presupuesto), QA10 (contradicción → detener + escalar), la continuidad (QA14)
 * y que supervisar solo proyecta metadatos (ADR 0007), registrando todo en `MisionEvento` + `AuditLog`.
 */
describe('MissionCoordinatorGovernanceService (ADR 0016 Inc.3, gated)', () => {
  const WS = 'ws-1';
  const MIS = 'mis-1';
  const COORD = 'agente-coordinador';

  function build(flagActivo: boolean, agent?: { suplenteUserId: string | null; reportaAAgentId: string | null }) {
    const eventos: Array<Record<string, unknown>> = [];
    const auditorias: Array<Record<string, unknown>> = [];
    const prisma = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ coordinadorGobiernoActivo: flagActivo }),
      },
      misionTransversal: {
        findFirst: jest.fn().mockResolvedValue({ id: MIS }),
      },
      misionEvento: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          eventos.push(data);
          return Promise.resolve({ id: `ev-${eventos.length}`, ...data });
        }),
      },
      agent: {
        findFirst: jest.fn().mockResolvedValue(agent ?? { suplenteUserId: null, reportaAAgentId: null }),
      },
    };
    const audit = {
      append: jest.fn().mockImplementation((_ws: string, e: Record<string, unknown>) => {
        auditorias.push(e);
        return Promise.resolve({ id: `a-${auditorias.length}` });
      }),
    };

    const service = new MissionCoordinatorGovernanceService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
    return { service, eventos, auditorias, prisma, audit };
  }

  // --- Flag APAGADO: sin ningún efecto (prueba de la compuerta E-B, opt-in por workspace) ---------------------------

  describe('flag APAGADO = sin efecto', () => {
    it('ninguna capacidad persiste eventos ni audita cuando coordinadorGobiernoActivo=false', async () => {
      const { service, eventos, auditorias, prisma } = build(false);

      const r1 = await service.seguimientoCompromisos(WS, MIS, COORD, [{ plazoMs: 10, ahoraMs: 5, entregado: false }]);
      const r2 = await service.evaluarBloqueo(WS, MIS, COORD, {
        origen: 'CONTRADICCION_AUTORIDAD',
        frenaResultadoNegocio: true,
        sinReglaInequivoca: true,
      });
      const r3 = await service.evaluarPresupuesto(WS, MIS, COORD, {
        origenCoordinador: true,
        montoActual: 100,
        montoSolicitado: 200,
      });
      const r4 = await service.supervisar(WS, MIS, COORD, 'otro', { estado: 'OK', secreto: 'x' });
      const r5 = await service.resolverContradiccion(WS, MIS, COORD, []);
      const r6 = await service.continuidadPorSuspension(WS, MIS, COORD);

      for (const r of [r1, r2, r3, r4, r5, r6]) {
        expect(r.aplicado).toBe(false);
        expect((r as { motivo: string }).motivo).toBe(MissionCoordinatorGovernanceService.MOTIVO_GATED);
      }
      expect(eventos).toHaveLength(0);
      expect(auditorias).toHaveLength(0);
      // Ni siquiera se consulta la misión: el flag corta antes (gated).
      expect(prisma.misionTransversal.findFirst).not.toHaveBeenCalled();
    });

    it('proponerAccion no bloquea ni audita con el flag apagado (no hay efecto alguno)', async () => {
      const { service, auditorias } = build(false);
      const r = await service.proponerAccion(WS, MIS, {
        accion: 'SUSPENDER_AGENTE',
        solicitanteId: COORD,
        solicitanteTipo: 'AGENTE',
        aprobadorId: COORD,
        aprobadorTipo: 'AGENTE',
      });
      expect(r.aplicado).toBe(false);
      expect(auditorias).toHaveLength(0);
    });
  });

  // --- Flag ENCENDIDO: QA13 (no autoaprobación / no ampliar-mover presupuesto) --------------------------------------

  describe('QA13 — no autoaprobación ni ampliación de presupuesto', () => {
    it('bloquea y audita la autoaprobación del coordinador de una acción de alto impacto', async () => {
      const { service, auditorias } = build(true);
      await expect(
        service.proponerAccion(WS, MIS, {
          accion: 'MOVER_PRESUPUESTO',
          solicitanteId: COORD,
          solicitanteTipo: 'AGENTE',
          aprobadorId: COORD, // el propio coordinador se "aprueba"
          aprobadorTipo: 'AGENTE',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(auditorias.some((a) => a.action === AUDIT_ACTIONS.MISION_COORDINADOR_AUTOAPROBACION_BLOQUEADA)).toBe(true);
    });

    it('una acción de alto impacto bien planteada solo SOLICITA decisión humana, no ejecuta', async () => {
      const { service, eventos } = build(true);
      const r = await service.proponerAccion(WS, MIS, {
        accion: 'SUSPENDER_AGENTE',
        solicitanteId: COORD,
        solicitanteTipo: 'AGENTE',
        aprobadorId: 'humano-jefe',
        aprobadorTipo: 'HUMANO',
      });
      expect(r).toMatchObject({ aplicado: true, requiereAprobacionHumana: true });
      expect(eventos.some((e) => e.tipo === 'DECISION_HUMANA_SOLICITADA' && e.requiereDecision === true)).toBe(true);
    });

    it('ampliar o mover presupuesto exige aprobación humana y NUNCA se aplica', async () => {
      const { service, eventos } = build(true);
      const ampliar = await service.evaluarPresupuesto(WS, MIS, COORD, {
        origenCoordinador: true,
        montoActual: 100,
        montoSolicitado: 150,
      });
      expect(ampliar).toMatchObject({ aplicado: true, aplicableSinAprobacion: false, requiereAprobacionHumana: true });
      expect(eventos.some((e) => e.tipo === 'DECISION_HUMANA_SOLICITADA')).toBe(true);
    });

    it('delegar permisos nunca amplía: solo devuelve el subconjunto del delegante', () => {
      const { service } = build(true);
      const r = service.delegarPermisos(['leer', 'escribir'], ['leer', 'borrar']);
      expect(r.permitida).toBe(false);
      expect(r.concedidos).toEqual(['leer']);
      expect(r.excedentes).toEqual(['borrar']);
    });
  });

  // --- Flag ENCENDIDO: QA10 (contradicción → detener y escalar) -----------------------------------------------------

  describe('QA10 — contradicción sin regla inequívoca', () => {
    it('detiene y solicita decisión humana ante órdenes empatadas', async () => {
      const { service, eventos, auditorias } = build(true);
      const r = await service.resolverContradiccion(WS, MIS, COORD, [
        { id: 'o1', nivelEmisor: 'DIRECTOR', prioridad: 5, version: 1, vigente: true },
        { id: 'o2', nivelEmisor: 'DIRECTOR', prioridad: 5, version: 1, vigente: true },
      ]);
      expect(r).toMatchObject({ aplicado: true, decision: 'DETENER_Y_ESCALAR', detener: true });
      expect(eventos.some((e) => e.tipo === 'CONTRADICCION' && e.requiereDecision === true)).toBe(true);
      expect(eventos.some((e) => e.tipo === 'DECISION_HUMANA_SOLICITADA')).toBe(true);
      expect(auditorias.some((a) => a.action === AUDIT_ACTIONS.MISION_COORDINADOR_CONTRADICCION)).toBe(true);
    });

    it('cuando hay una orden de mayor autoridad, gana sin escalar', async () => {
      const { service, eventos } = build(true);
      const r = await service.resolverContradiccion(WS, MIS, COORD, [
        { id: 'o1', nivelEmisor: 'GERENTE', prioridad: 1, version: 1, vigente: true },
        { id: 'o2', nivelEmisor: 'JEFE', prioridad: 9, version: 9, vigente: true },
      ]);
      expect(r).toMatchObject({ decision: 'ORDEN_GANADORA', ganadoraId: 'o1' });
      expect(eventos.some((e) => e.tipo === 'CONTRADICCION')).toBe(false);
    });
  });

  // --- Flag ENCENDIDO: supervisión (ADR 0007) y continuidad (QA14) --------------------------------------------------

  describe('supervisión y continuidad', () => {
    it('supervisar solo proyecta metadatos permitidos (no concede acceso, ADR 0007)', async () => {
      const { service, eventos } = build(true);
      const r = await service.supervisar(WS, MIS, COORD, 'otro-agente', {
        estado: 'EN_CURSO',
        compromisosVencidos: 2,
        contenidoPrivado: 'no debe verse',
        credencial: 'secreta',
      });
      expect(r.aplicado).toBe(true);
      const metadatos = (r as { metadatos: Record<string, unknown> }).metadatos;
      expect(metadatos).toHaveProperty('estado');
      expect(metadatos).toHaveProperty('compromisosVencidos');
      expect(metadatos).not.toHaveProperty('contenidoPrivado');
      expect(metadatos).not.toHaveProperty('credencial');
      expect(eventos.some((e) => e.tipo === 'SUPERVISION')).toBe(true);
    });

    it('continuidad al suspender registra el suplente (QA14); el trabajo autorizado no se toca aquí', async () => {
      const { service, eventos, prisma } = build(true, { suplenteUserId: 'humano-suplente', reportaAAgentId: 'jefe' });
      const r = await service.continuidadPorSuspension(WS, MIS, COORD);
      expect(r).toMatchObject({ aplicado: true, suplenteUserId: 'humano-suplente', supervisorAgentId: 'jefe' });
      expect(eventos.some((e) => e.tipo === 'CONTINUIDAD')).toBe(true);
      // No muta tareas/objetivos: no hay ninguna escritura sobre ellos (solo lectura del agente y creación de evento).
      expect(prisma.agent.findFirst).toHaveBeenCalled();
    });

    it('continuidad sin suplente ni supervisor exige decisión humana', async () => {
      const { service, eventos } = build(true, { suplenteUserId: null, reportaAAgentId: null });
      await service.continuidadPorSuspension(WS, MIS, COORD);
      const ev = eventos.find((e) => e.tipo === 'CONTINUIDAD');
      expect(ev?.requiereDecision).toBe(true);
    });
  });
});
