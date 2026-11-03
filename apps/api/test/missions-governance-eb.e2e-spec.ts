import type { INestApplication } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { AuditService } from '../src/modules/audit/audit.service';
import { MissionCoordinatorGovernanceService } from '../src/modules/missions/mission-coordinator-governance.service';
import { createTestApp, prismaOf } from './utils/app';
import { createAgent, registerOwner, rootUnit, type Session } from './utils/fixtures';

interface Mision {
  id: string;
  estado: string;
  coordinadorAgentId: string | null;
}

/**
 * Gobierno de la continuidad del coordinador (ADR 0016 · Inc.3 · compuerta E-B) contra Postgres/Redis reales. Pruebas
 * CONTROLADAS, no operativas en producción:
 *  - Con el opt-in `coordinadorGobiernoActivo` APAGADO (por defecto), el coordinador NO produce ningún efecto: ni
 *    `MisionEvento`, ni `AuditLog`, ni cambio de estado (compuerta E-B).
 *  - Con el flag ENCENDIDO: QA13 (no autoaprobación / no ampliar-mover presupuesto / no otorgarse permisos / no borrar
 *    auditoría), QA14 (suspender al coordinador y continuar sin perder estado) y QA10 (contradicción → detener + escalar).
 *  - Supervisar NO concede acceso (ADR 0007).
 * Toda acción irreversible/alto impacto solo se SOLICITA a un humano; el servicio nunca ejecuta el efecto.
 */
describe('Gobierno del coordinador de misiones · compuerta E-B (e2e)', () => {
  let app: INestApplication;
  let owner: Session;
  let gov: MissionCoordinatorGovernanceService;
  let audit: AuditService;

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'mision-eb-owner');
    gov = app.get(MissionCoordinatorGovernanceService);
    audit = app.get(AuditService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function crearMisionAutorizada(nombre: string): Promise<{ mision: Mision; coordId: string }> {
    const coord = await createAgent(owner, { name: `Coord ${nombre}` });
    const creada = (
      await owner.api
        .post('/missions', { nombre, resultadoEsperado: 'Cerrar ciclo transversal', coordinadorAgentId: coord.id })
        .expect(201)
    ).body as Mision;
    const mision = (await owner.api.post(`/missions/${creada.id}/authorize`, {}).expect(201)).body as Mision;
    return { mision, coordId: coord.id };
  }

  async function setFlag(activo: boolean): Promise<void> {
    await prismaOf(app).workspace.update({
      where: { id: owner.workspaceId },
      data: { coordinadorGobiernoActivo: activo },
    });
  }

  function contarEventos(misionId: string) {
    return prismaOf(app).misionEvento.count({ where: { workspaceId: owner.workspaceId, misionId } });
  }

  it('flag APAGADO (por defecto) = sin efecto: ni eventos ni auditoría ni cambio de estado', async () => {
    await setFlag(false);
    const { mision, coordId } = await crearMisionAutorizada('EB apagado');

    const auditAntes = await prismaOf(app).auditLog.count({ where: { workspaceId: owner.workspaceId } });

    const r1 = await gov.seguimientoCompromisos(owner.workspaceId, mision.id, coordId, [
      { plazoMs: 1, ahoraMs: 2, entregado: false },
    ]);
    const r2 = await gov.evaluarBloqueo(owner.workspaceId, mision.id, coordId, {
      origen: 'CONTRADICCION_AUTORIDAD',
      frenaResultadoNegocio: true,
      sinReglaInequivoca: true,
    });
    const r3 = await gov.evaluarPresupuesto(owner.workspaceId, mision.id, coordId, {
      origenCoordinador: true,
      montoActual: 100,
      montoSolicitado: 500,
    });
    const r4 = await gov.supervisar(owner.workspaceId, mision.id, coordId, 'otro', { estado: 'OK' });
    const r5 = await gov.resolverContradiccion(owner.workspaceId, mision.id, coordId, []);
    const r6 = await gov.continuidadPorSuspension(owner.workspaceId, mision.id, coordId);

    for (const r of [r1, r2, r3, r4, r5, r6]) {
      expect(r.aplicado).toBe(false);
    }
    expect(await contarEventos(mision.id)).toBe(0);
    const auditDespues = await prismaOf(app).auditLog.count({ where: { workspaceId: owner.workspaceId } });
    expect(auditDespues).toBe(auditAntes);

    const leida = (await owner.api.get(`/missions/${mision.id}`).expect(200)).body as Mision;
    expect(leida.estado).toBe('AUTORIZADA'); // el coordinador no cambió nada
  });

  it('QA13: autoaprobación bloqueada y auditada; presupuesto no se amplía; delegar no amplía', async () => {
    await setFlag(true);
    const { mision, coordId } = await crearMisionAutorizada('EB QA13');

    await expect(
      gov.proponerAccion(owner.workspaceId, mision.id, {
        accion: 'MOVER_PRESUPUESTO',
        solicitanteId: coordId,
        solicitanteTipo: 'AGENTE',
        aprobadorId: coordId,
        aprobadorTipo: 'AGENTE',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const bloqueo = (
      await owner.api
        .get(`/auditoria?action=MISION_COORDINADOR_AUTOAPROBACION_BLOQUEADA&targetId=${mision.id}`)
        .expect(200)
    ).body as { items: unknown[] };
    expect(bloqueo.items).toHaveLength(1);

    const presu = await gov.evaluarPresupuesto(owner.workspaceId, mision.id, coordId, {
      origenCoordinador: true,
      montoActual: 100,
      montoSolicitado: 300,
    });
    expect(presu).toMatchObject({ aplicado: true, aplicableSinAprobacion: false, requiereAprobacionHumana: true });

    const deleg = gov.delegarPermisos(['leer'], ['leer', 'escribir']);
    expect(deleg.concedidos).toEqual(['leer']);
    expect(deleg.excedentes).toEqual(['escribir']);
  });

  it('QA10: contradicción sin regla inequívoca → detiene y escala (eventos + auditoría encadenada)', async () => {
    await setFlag(true);
    const { mision, coordId } = await crearMisionAutorizada('EB QA10');

    const r = await gov.resolverContradiccion(owner.workspaceId, mision.id, coordId, [
      { id: 'o1', nivelEmisor: 'DIRECTOR', prioridad: 5, version: 1, vigente: true },
      { id: 'o2', nivelEmisor: 'DIRECTOR', prioridad: 5, version: 1, vigente: true },
    ]);
    expect(r).toMatchObject({ aplicado: true, decision: 'DETENER_Y_ESCALAR', requiereDecisionHumana: true });

    const contradiccion = await prismaOf(app).misionEvento.count({
      where: { workspaceId: owner.workspaceId, misionId: mision.id, tipo: 'CONTRADICCION', requiereDecision: true },
    });
    const solicitud = await prismaOf(app).misionEvento.count({
      where: { workspaceId: owner.workspaceId, misionId: mision.id, tipo: 'DECISION_HUMANA_SOLICITADA' },
    });
    expect(contradiccion).toBe(1);
    expect(solicitud).toBe(1);

    // La cadena de auditoría (E13) sigue íntegra tras registrar el escalamiento.
    const cadena = await audit.verificarCadena(owner.workspaceId);
    expect(cadena.ok).toBe(true);
  });

  it('QA14: suspender al coordinador → continuidad con suplente sin perder estado', async () => {
    await setFlag(true);
    const { mision, coordId } = await crearMisionAutorizada('EB QA14');
    // El coordinador tiene suplente humano (E3): se fija directamente para la prueba.
    await prismaOf(app).agent.update({ where: { id: coordId }, data: { suplenteUserId: owner.userId } });

    const estadoAntes = (await owner.api.get(`/missions/${mision.id}`).expect(200)).body as Mision;

    const r = await gov.continuidadPorSuspension(owner.workspaceId, mision.id, coordId);
    expect(r).toMatchObject({ aplicado: true, suplenteUserId: owner.userId });

    const continuidad = await prismaOf(app).misionEvento.count({
      where: { workspaceId: owner.workspaceId, misionId: mision.id, tipo: 'CONTINUIDAD' },
    });
    expect(continuidad).toBe(1);

    // El estado de la misión y su trabajo autorizado NO se pierden: siguen en Postgres sin cambios.
    const estadoDespues = (await owner.api.get(`/missions/${mision.id}`).expect(200)).body as Mision;
    expect(estadoDespues.estado).toBe(estadoAntes.estado);
    expect(estadoDespues.coordinadorAgentId).toBe(coordId);
  });

  it('supervisar NO concede acceso (ADR 0007): solo metadatos permitidos + evento SUPERVISION', async () => {
    await setFlag(true);
    const { mision, coordId } = await crearMisionAutorizada('EB supervision');

    const r = await gov.supervisar(owner.workspaceId, mision.id, coordId, 'agente-observado', {
      estado: 'EN_CURSO',
      compromisosVencidos: 1,
      contenidoSensible: 'no debe aparecer',
    });
    expect(r.aplicado).toBe(true);
    const metadatos = (r as { metadatos: Record<string, unknown> }).metadatos;
    expect(metadatos).not.toHaveProperty('contenidoSensible');
    expect(metadatos).toHaveProperty('estado');

    const supervision = await prismaOf(app).misionEvento.count({
      where: { workspaceId: owner.workspaceId, misionId: mision.id, tipo: 'SUPERVISION' },
    });
    expect(supervision).toBe(1);
  });

  it('informe ejecutivo GATED: con el flag apagado devuelve el motivo y no agrega nada', async () => {
    await setFlag(false);
    const { mision } = await crearMisionAutorizada('EB informe off');
    const r = (await owner.api.get(`/missions/${mision.id}/executive-report`).expect(200)).body as {
      disponible: boolean;
      motivo?: string;
    };
    expect(r.disponible).toBe(false);
    expect(r.motivo).toBe(MissionCoordinatorGovernanceService.MOTIVO_GATED);
  });

  it('informe ejecutivo con flag encendido agrega estado/avance/compromisos/bloqueos (solo lectura)', async () => {
    await setFlag(true);
    const { mision } = await crearMisionAutorizada('EB informe on');
    const root = await rootUnit(owner);
    // Trabajo vinculado: una tarea vencida → compromiso VENCIDO + bloqueo DEPENDENCIA_VENCIDA (derivados de E4).
    const tarea = await prismaOf(app).tarea.create({
      data: {
        workspaceId: owner.workspaceId,
        titulo: 'Entrega transversal',
        orgUnitId: root.id,
        fechaLimite: new Date(Date.now() - 86_400_000),
      },
    });
    await owner.api.post(`/missions/${mision.id}/links`, { tareaId: tarea.id }).expect(201);
    await owner.api.post(`/missions/${mision.id}/participants`, { orgUnitId: root.id }).expect(201);

    const r = (await owner.api.get(`/missions/${mision.id}/executive-report`).expect(200)).body as {
      disponible: boolean;
      avance: { totalTareas: number };
      compromisos: { estado: string }[];
      vencimientos: unknown[];
      bloqueos: { origen: string }[];
    };
    expect(r.disponible).toBe(true);
    expect(r.avance.totalTareas).toBe(1);
    expect(r.compromisos).toHaveLength(1);
    expect(r.compromisos[0].estado).toBe('VENCIDO');
    expect(r.vencimientos).toHaveLength(1);
    expect(r.bloqueos.some((b) => b.origen === 'DEPENDENCIA_VENCIDA')).toBe(true);
  });

  it('asignación gobernada: admisible dentro de nivel y alcance → solo solicita decisión humana', async () => {
    await setFlag(true);
    const { mision, coordId } = await crearMisionAutorizada('EB asignacion');
    const root = await rootUnit(owner);
    const ejecutor = await createAgent(owner, { name: 'Ejecutor' });
    const tarea = await prismaOf(app).tarea.create({
      data: { workspaceId: owner.workspaceId, titulo: 'Tarea asignable', orgUnitId: root.id },
    });
    await owner.api.post(`/missions/${mision.id}/participants`, { orgUnitId: root.id }).expect(201);

    const r = await gov.proponerAsignacion(owner.workspaceId, mision.id, coordId, {
      tareaId: tarea.id,
      asignadoAgentId: ejecutor.id,
      permisosCoordinador: ['crm:read'],
      permisosSolicitados: ['crm:read', 'crm:write'],
    });
    expect(r.aplicado).toBe(true);
    if (r.aplicado) {
      expect(r.propuesta.permisosConcedidos).toEqual(['crm:read']);
      expect(r.propuesta.permisosNoConcedidos).toEqual(['crm:write']); // no concede lo que no posee
      expect(r.propuesta.requiereAprobacionHumana).toBe(true);
    }

    const pendientes = await prismaOf(app).misionEvento.count({
      where: { workspaceId: owner.workspaceId, misionId: mision.id, tipo: 'DECISION_HUMANA_SOLICITADA' },
    });
    expect(pendientes).toBeGreaterThanOrEqual(1);

    // El informe ejecutivo refleja el pendiente de decisión humana.
    const informe = (await owner.api.get(`/missions/${mision.id}/executive-report`).expect(200)).body as {
      pendientesDecisionHumana: unknown[];
    };
    expect(informe.pendientesDecisionHumana.length).toBeGreaterThanOrEqual(1);
  });

  it('asignación gobernada: fuera del alcance autorizado → bloqueada y auditada (no ejecuta)', async () => {
    await setFlag(true);
    const { mision, coordId } = await crearMisionAutorizada('EB asignacion fuera');
    const root = await rootUnit(owner);
    const ejecutor = await createAgent(owner, { name: 'Ejecutor fuera' });
    const tarea = await prismaOf(app).tarea.create({
      data: { workspaceId: owner.workspaceId, titulo: 'Tarea fuera de alcance', orgUnitId: root.id },
    });
    // No se declara participante → la tarea queda FUERA del alcance autorizado de la misión.
    await expect(
      gov.proponerAsignacion(owner.workspaceId, mision.id, coordId, {
        tareaId: tarea.id,
        asignadoAgentId: ejecutor.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const bloqueo = (
      await owner.api.get(`/auditoria?action=MISION_COORDINADOR_ASIGNACION_BLOQUEADA&targetId=${mision.id}`).expect(200)
    ).body as { items: unknown[] };
    expect(bloqueo.items).toHaveLength(1);
  });

  it('otro workspace no afecta: el flag y los eventos están aislados por tenant', async () => {
    await setFlag(true);
    const otro = await registerOwner(app, 'mision-eb-otro');
    // El otro workspace nace con el flag apagado: su coordinador no produce efecto aunque el primero lo tenga activo.
    const coordOtro = await createAgent(otro, { name: 'Coord otro' });
    const misOtro = (
      await otro.api
        .post('/missions', {
          nombre: 'Otro tenant',
          resultadoEsperado: 'Resultado del otro tenant',
          coordinadorAgentId: coordOtro.id,
        })
        .expect(201)
    ).body as Mision;
    const r = await gov.resolverContradiccion(otro.workspaceId, misOtro.id, coordOtro.id, [
      { id: 'a', nivelEmisor: 'JEFE', prioridad: 1, version: 1, vigente: true },
      { id: 'b', nivelEmisor: 'JEFE', prioridad: 1, version: 1, vigente: true },
    ]);
    expect(r.aplicado).toBe(false); // gated en el otro workspace
    expect(await contarEventos(misOtro.id)).toBe(0);
  });
});
