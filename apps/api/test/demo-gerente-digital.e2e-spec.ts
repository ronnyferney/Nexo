import type { INestApplication } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { AuditService } from '../src/modules/audit/audit.service';
import { MissionCoordinatorGovernanceService } from '../src/modules/missions/mission-coordinator-governance.service';
import { createTestApp, prismaOf } from './utils/app';
import { addMember, registerOwner, rootUnit, type Session } from './utils/fixtures';

/**
 * DEMOSTRACIÓN FUNCIONAL INTEGRAL · GERENTE DIGITAL (ADR 0016 · compuerta E-B). Recorrido de validación integral, en
 * AMBIENTE CONTROLADO y con DATOS SINTÉTICOS, de un GERENTE DIGITAL (coordinador superempleado) que: recibe un objetivo,
 * coordina varios agentes subordinados, propone la distribución de tareas DENTRO de permisos, supervisa resultados,
 * identifica un bloqueo y lo escala, y presenta un INFORME GERENCIAL. Verifica además la TRAZABILIDAD: cada acción queda
 * en la auditoría inmutable (E13) y la cadena por hash permanece íntegra.
 *
 * GOBIERNO DE LA DEMO (no negociable, se afirma en las pruebas):
 *  - El flag `coordinadorGobiernoActivo` se ENCIENDE SOLO en el workspace sintético creado por esta demo (ambiente
 *    controlado); jamás toca datos reales. Con el flag APAGADO se demuestra el GATING: el coordinador no produce efecto.
 *  - NO hay gasto, NO hay canales reales, NO hay LLM de pago: los agentes usan el proveedor `mock`.
 *  - Ninguna acción crítica se auto-ejecuta: el coordinador PROPONE y SOLICITA; un humano (ADMIN de prueba) decide.
 *  - QA13: el coordinador no se autoaprueba ni compromete/ mueve presupuesto por su cuenta.
 *
 * Es la contraparte INTEGRAL (recorrido completo por API + servicio) de `missions-governance-eb.e2e-spec.ts` (que cubre
 * cada invariante por separado). Sirve de guion reproducible para el patrocinador (ver `docs/demo-gerente-digital.md`).
 */
describe('Demo integral · Gerente digital que coordina una misión (e2e)', () => {
  let app: INestApplication;
  /** "Patrocinador" humano: OWNER del workspace sintético. Crea/autoriza la misión y origina las solicitudes E6. */
  let patrocinador: Session;
  /** ADMIN de prueba distinto: aprobador humano explícito de la bandeja E6 (no autoaprobación, QA13). */
  let aprobador: Session;
  let gov: MissionCoordinatorGovernanceService;
  let audit: AuditService;

  // Datos sintéticos compartidos a lo largo del recorrido.
  let rootId: string; // unidad/empresa raíz: alcance autorizado de la misión
  let gerenteDigitalId: string; // coordinador superempleado
  let agenteCobranzaId: string; // subordinado (nivel JEFE)
  let agenteLegalId: string; // subordinado (nivel LIDER)
  let objetivoId: string;
  let misionId: string;
  let tareaCobranzaId: string; // tarea con contrato de resultado de negocio
  let tareaLegalId: string; // tarea que terminará bloqueada (incumplimiento sintético)
  let tareaVencidaId: string; // tarea con plazo vencido → compromiso VENCIDO + dependencia vencida

  beforeAll(async () => {
    app = await createTestApp();
    patrocinador = await registerOwner(app, 'demo-gerente');
    aprobador = await addMember(app, patrocinador, { role: 'ADMIN', tag: 'demo-aprobador' });
    gov = app.get(MissionCoordinatorGovernanceService);
    audit = app.get(AuditService);
    rootId = (await rootUnit(patrocinador)).id;
  });

  afterAll(async () => {
    // Deja el workspace sintético con el flag APAGADO (estado por defecto): la demo no deja gobierno encendido.
    await setFlag(false);
    await app.close();
  });

  // --- Utilidades -----------------------------------------------------------------------------------------------------

  async function setFlag(activo: boolean): Promise<void> {
    await prismaOf(app).workspace.update({
      where: { id: patrocinador.workspaceId },
      data: { coordinadorGobiernoActivo: activo },
    });
  }

  async function crearCargo(nombre: string, nivel: string): Promise<string> {
    const r = await patrocinador.api.post('/cargos', { nombre, nivel }).expect(201);
    return (r.body as { id: string }).id;
  }

  async function crearAgente(name: string, cargoId: string): Promise<string> {
    const r = await patrocinador.api
      .post('/agents', { name, provider: 'mock', model: 'mock-echo', cargoId })
      .expect(201);
    return (r.body as { id: string }).id;
  }

  async function eventosPorTipo(tipo: string): Promise<number> {
    return prismaOf(app).misionEvento.count({
      where: { workspaceId: patrocinador.workspaceId, misionId, tipo: tipo as never },
    });
  }

  async function auditoria(action: string): Promise<unknown[]> {
    const r = await patrocinador.api.get(`/auditoria?action=${action}&targetId=${misionId}`).expect(200);
    return (r.body as { items: unknown[] }).items;
  }

  // --- Paso 0 · Datos sintéticos + GATING con el flag APAGADO ---------------------------------------------------------

  it('Paso 0 · prepara la empresa sintética (gerente digital + agentes subordinados + objetivo/tareas)', async () => {
    // Cargos: el gerente digital es SUPEREMPLEADO (coordina, no ejecuta); subordinados de menor nivel.
    const cargoGerente = await crearCargo('Gerente digital', 'SUPEREMPLEADO');
    const cargoJefe = await crearCargo('Jefe de cobranza', 'JEFE');
    const cargoLider = await crearCargo('Líder jurídico', 'LIDER');

    gerenteDigitalId = await crearAgente('Gerente Digital Nexo', cargoGerente);
    agenteCobranzaId = await crearAgente('Agente Cobranza', cargoJefe);
    agenteLegalId = await crearAgente('Agente Jurídico', cargoLider);

    // Objetivo con tareas sintéticas (trabajo por resultados E4).
    const obj = (
      await patrocinador.api
        .post('/objetivos', {
          codigo: `OBJ-DEMO-${Date.now()}`,
          nombre: 'Reducir cartera vencida Q4',
          orgUnitId: rootId,
          indicador: 'Cartera vencida (USD)',
          lineaBase: '1000000',
          meta: '600000',
        })
        .expect(201)
    ).body as { id: string };
    objetivoId = obj.id;

    // Tarea de cobranza con contrato de RESULTADO_NEGOCIO (verificable).
    tareaCobranzaId = (
      (
        await patrocinador.api
          .post('/tareas', {
            titulo: 'Gestionar cartera cliente estratégico',
            objetivoId,
            orgUnitId: rootId,
            tipoResultado: 'RESULTADO_NEGOCIO',
            responsableAgentId: agenteCobranzaId,
            duenoUserId: patrocinador.userId,
            criterioAceptacion: 'Acuerdo de pago firmado',
            fechaLimite: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          })
          .expect(201)
      ).body as { id: string }
    ).id;
    const contrato = (
      await patrocinador.api
        .post(`/tareas/${tareaCobranzaId}/contrato`, {
          resultadoEsperado: 'Acuerdo de pago confirmado en el sistema',
          tipoResultado: 'RESULTADO_NEGOCIO',
          responsableAgentId: agenteCobranzaId,
          duenoUserId: patrocinador.userId,
          reglaValidacion: { rules: [{ left: '{{ acuerdo.firmado }}', operator: 'eq', right: true }] },
          evidenciaExigida: ['acuerdo_firmado'],
        })
        .expect(201)
    ).body as { id: string };
    await patrocinador.api.post(`/contratos/${contrato.id}/comprometer`).expect(201);

    // Tarea jurídica que terminará BLOQUEADA (bloqueo sintético para la supervisión del gerente).
    tareaLegalId = (
      (
        await patrocinador.api
          .post('/tareas', {
            titulo: 'Revisar viabilidad jurídica de quita',
            objetivoId,
            orgUnitId: rootId,
            responsableAgentId: agenteLegalId,
            duenoUserId: patrocinador.userId,
            fechaLimite: new Date(Date.now() + 3 * 86_400_000).toISOString(),
          })
          .expect(201)
      ).body as { id: string }
    ).id;

    // Tarea con plazo YA vencido → compromiso VENCIDO + bloqueo DEPENDENCIA_VENCIDA en el informe.
    tareaVencidaId = (
      (
        await patrocinador.api
          .post('/tareas', {
            titulo: 'Conciliar saldos con tesorería',
            objetivoId,
            orgUnitId: rootId,
            responsableAgentId: agenteCobranzaId,
            duenoUserId: patrocinador.userId,
            fechaLimite: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          })
          .expect(201)
      ).body as { id: string }
    ).id;

    expect(gerenteDigitalId).toBeDefined();
    expect(objetivoId).toBeDefined();
  });

  it('Paso 0b · GATING: con el flag APAGADO el gerente digital NO produce efecto (compuerta E-B)', async () => {
    await setFlag(false);
    // Una misión mínima para probar que ni siquiera así el coordinador actúa con el flag apagado.
    const creada = (
      await patrocinador.api
        .post('/missions', {
          nombre: 'Misión (gating)',
          resultadoEsperado: 'No debe producir efecto con el flag apagado',
          coordinadorAgentId: gerenteDigitalId,
        })
        .expect(201)
    ).body as { id: string };
    const auditAntes = await prismaOf(app).auditLog.count({ where: { workspaceId: patrocinador.workspaceId } });

    const seg = await gov.seguimientoCompromisos(patrocinador.workspaceId, creada.id, gerenteDigitalId, [
      { plazoMs: 1, ahoraMs: 2, entregado: false },
    ]);
    const informe = (
      await patrocinador.api.get(`/missions/${creada.id}/executive-report`).expect(200)
    ).body as { disponible: boolean; motivo?: string };

    expect(seg.aplicado).toBe(false);
    expect(informe.disponible).toBe(false);
    expect(informe.motivo).toBe(MissionCoordinatorGovernanceService.MOTIVO_GATED);
    // Ni un solo evento ni una sola entrada de auditoría: el gobierno apagado no escribe nada.
    expect(
      await prismaOf(app).misionEvento.count({ where: { workspaceId: patrocinador.workspaceId, misionId: creada.id } }),
    ).toBe(0);
    const auditDespues = await prismaOf(app).auditLog.count({ where: { workspaceId: patrocinador.workspaceId } });
    expect(auditDespues).toBe(auditAntes);
  });

  // --- Paso A · El gerente digital RECIBE un objetivo → se crea la misión transversal ---------------------------------

  it('Paso A · el gerente digital recibe el objetivo: se crea y autoriza la misión (ambiente controlado)', async () => {
    // ENCENDER el gobierno SOLO en este workspace sintético (ambiente controlado, decisión del patrocinador).
    await setFlag(true);

    const creada = (
      await patrocinador.api
        .post('/missions', {
          nombre: 'Reducción de cartera vencida Q4 (transversal)',
          proposito: 'Coordinar cobranza y jurídica para bajar la cartera vencida',
          resultadoEsperado: 'Cartera vencida reducida de 1M a 600k USD',
          indicador: 'Cartera vencida (USD)',
          lineaBase: '1000000',
          meta: '600000',
          coordinadorAgentId: gerenteDigitalId,
        })
        .expect(201)
    ).body as { id: string; estado: string };
    misionId = creada.id;
    expect(creada.estado).toBe('PROPUESTA');

    // El humano patrocinador AUTORIZA (ningún agente autoriza misiones: AGENTE_NO_CREA_AGENTES).
    const autorizada = (await patrocinador.api.post(`/missions/${misionId}/authorize`, {}).expect(201)).body as {
      estado: string;
      coordinadorAgentId: string | null;
    };
    expect(autorizada.estado).toBe('AUTORIZADA');
    expect(autorizada.coordinadorAgentId).toBe(gerenteDigitalId);

    // Declara el alcance autorizado (participante) y agrupa el trabajo existente por referencia (NO concede acceso).
    await patrocinador.api.post(`/missions/${misionId}/participants`, { orgUnitId: rootId }).expect(201);
    await patrocinador.api.post(`/missions/${misionId}/links`, { objetivoId }).expect(201);
    await patrocinador.api.post(`/missions/${misionId}/links`, { tareaId: tareaCobranzaId }).expect(201);
    await patrocinador.api.post(`/missions/${misionId}/links`, { tareaId: tareaLegalId }).expect(201);
    await patrocinador.api.post(`/missions/${misionId}/links`, { tareaId: tareaVencidaId }).expect(201);
  });

  // --- Paso B · COORDINA: propone la distribución de tareas; la aplicación exige aprobación humana (E6) ---------------

  it('Paso B · coordina y propone asignaciones dentro de permisos (cada una queda pendiente de decisión humana)', async () => {
    // El coordinador PROPONE asignar la tarea de cobranza al agente de cobranza, DENTRO de su nivel y alcance.
    const prop = await gov.proponerAsignacion(patrocinador.workspaceId, misionId, gerenteDigitalId, {
      tareaId: tareaCobranzaId,
      asignadoAgentId: agenteCobranzaId,
      permisosCoordinador: ['cobranza:leer', 'cobranza:gestionar'],
      permisosSolicitados: ['cobranza:leer', 'cobranza:gestionar', 'tesoreria:transferir'],
    });
    expect(prop.aplicado).toBe(true);
    if (prop.aplicado) {
      // No concede lo que el coordinador no posee (ADR 0007/0014): 'tesoreria:transferir' queda sin conceder.
      expect(prop.propuesta.permisosConcedidos).toEqual(['cobranza:leer', 'cobranza:gestionar']);
      expect(prop.propuesta.permisosNoConcedidos).toEqual(['tesoreria:transferir']);
      // Aun admisible, APLICAR es alto impacto → exige aprobación humana; el coordinador nunca ejecuta.
      expect(prop.propuesta.requiereAprobacionHumana).toBe(true);
    }

    // Segunda asignación (tarea jurídica al agente jurídico), también solo propuesta.
    const prop2 = await gov.proponerAsignacion(patrocinador.workspaceId, misionId, gerenteDigitalId, {
      tareaId: tareaLegalId,
      asignadoAgentId: agenteLegalId,
      permisosCoordinador: ['juridico:leer'],
      permisosSolicitados: ['juridico:leer'],
    });
    expect(prop2.aplicado).toBe(true);

    // Ambas propuestas dejaron una solicitud de decisión humana en la línea de tiempo (bandeja E6 de la misión).
    expect(await eventosPorTipo('DECISION_HUMANA_SOLICITADA')).toBeGreaterThanOrEqual(2);
  });

  it('Paso B2 · la APLICACIÓN con impacto pasa por la bandeja E6 y la aprueba un ADMIN distinto (QA13)', async () => {
    // Una política exige aprobación para aplicar una asignación de misión con impacto.
    await aprobador.api
      .post('/admin/policies', {
        nombre: 'Aplicar asignación de misión requiere aprobación',
        tipoAccion: 'MISION_APLICAR_ASIGNACION',
        efecto: 'REQUIRE_APPROVAL',
      })
      .expect(201);

    // El patrocinador (humano) solicita aplicar la asignación propuesta por el gerente digital.
    const accion = (
      await patrocinador.api
        .post('/actions', {
          tipoAccion: 'MISION_APLICAR_ASIGNACION',
          proposito: 'Aplicar la asignación de cobranza propuesta por el gerente digital',
          tareaId: tareaCobranzaId,
          agentId: agenteCobranzaId,
          contenido: { tareaId: tareaCobranzaId, asignadoAgentId: agenteCobranzaId },
        })
        .expect(200)
    ).body as { estado: string; aprobacionId: string };
    expect(accion.estado).toBe('REQUIERE_APROBACION');

    // No autoaprobación (QA13): el solicitante no puede aprobar su propia acción.
    await patrocinador.api.post(`/approvals/${accion.aprobacionId}/decision`, { decision: 'APRUEBA' }).expect(400);

    // Un ADMIN de prueba DISTINTO la aprueba: aprobación humana explícita.
    const aprobada = (
      await aprobador.api.post(`/approvals/${accion.aprobacionId}/decision`, { decision: 'APRUEBA' }).expect(200)
    ).body as { estado: string };
    expect(aprobada.estado).toBe('APROBADA');
  });

  it('Paso B3 · QA13: el coordinador NO se autoaprueba ni mueve presupuesto por su cuenta', async () => {
    // Intento de autoaprobación de una acción de alto impacto por el propio coordinador → BLOQUEO + auditoría.
    await expect(
      gov.proponerAccion(patrocinador.workspaceId, misionId, {
        accion: 'MOVER_PRESUPUESTO',
        solicitanteId: gerenteDigitalId,
        solicitanteTipo: 'AGENTE',
        aprobadorId: gerenteDigitalId,
        aprobadorTipo: 'AGENTE',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect((await auditoria('MISION_COORDINADOR_AUTOAPROBACION_BLOQUEADA')).length).toBeGreaterThanOrEqual(1);

    // Cualquier movimiento de presupuesto originado por el coordinador exige aprobación humana; nunca se aplica solo.
    const presu = await gov.evaluarPresupuesto(patrocinador.workspaceId, misionId, gerenteDigitalId, {
      origenCoordinador: true,
      montoActual: 100,
      montoSolicitado: 100,
    });
    expect(presu).toMatchObject({ aplicado: true, aplicableSinAprobacion: false, requiereAprobacionHumana: true });
  });

  // --- Paso C · SUPERVISA resultados, detecta un BLOQUEO sintético y lo ESCALA --------------------------------------

  it('Paso C · supervisa, hace seguimiento de compromisos y escala un bloqueo sin regla inequívoca (QA10)', async () => {
    // Supervisión: solo metadatos de desempeño; NO concede acceso a contenido (ADR 0007).
    const sup = await gov.supervisar(patrocinador.workspaceId, misionId, gerenteDigitalId, agenteCobranzaId, {
      estado: 'EN_CURSO',
      compromisosVencidos: 1,
      contenidoSensible: 'datos del cliente — NO deben aparecer',
    });
    expect(sup.aplicado).toBe(true);
    if (sup.aplicado) {
      expect(sup.metadatos).not.toHaveProperty('contenidoSensible');
      expect(sup.metadatos).toHaveProperty('estado');
    }

    // Seguimiento de compromisos: uno vencido, uno en curso.
    const seg = await gov.seguimientoCompromisos(patrocinador.workspaceId, misionId, gerenteDigitalId, [
      { plazoMs: Date.now() - 86_400_000, ahoraMs: Date.now(), entregado: false, vinculoId: tareaVencidaId },
      { plazoMs: Date.now() + 86_400_000, ahoraMs: Date.now(), entregado: false, vinculoId: tareaCobranzaId },
    ]);
    expect(seg.aplicado).toBe(true);

    // Bloqueo sintético sobre la tarea jurídica: incumplimiento abierto + tarea BLOQUEADA (datos reales E4).
    await patrocinador.api
      .post(`/tareas/${tareaLegalId}/incumplimientos`, { causa: 'EVIDENCIA_INSUFICIENTE', maxReintentos: 2 })
      .expect(201);
    await patrocinador.api.post(`/tareas/${tareaLegalId}/estado`, { estado: 'BLOQUEADA' }).expect(201);

    // El gerente digital detecta el bloqueo; sin regla inequívoca → DETIENE y ESCALA (decisión humana, QA10).
    const bloqueo = await gov.evaluarBloqueo(
      patrocinador.workspaceId,
      misionId,
      gerenteDigitalId,
      { origen: 'INCUMPLIMIENTO', frenaResultadoNegocio: true, sinReglaInequivoca: true },
      { tareaId: tareaLegalId },
    );
    expect(bloqueo).toMatchObject({ aplicado: true, severidad: 'ALTA', requiereDecisionHumana: true });

    expect(await eventosPorTipo('SUPERVISION')).toBeGreaterThanOrEqual(1);
    expect(await eventosPorTipo('SEGUIMIENTO')).toBeGreaterThanOrEqual(1);
    expect(await eventosPorTipo('BLOQUEO_DETECTADO')).toBeGreaterThanOrEqual(1);
  });

  // --- Paso D · INFORME EJECUTIVO (gerencial): estado, avance, compromisos/vencimientos, bloqueos, pendientes --------

  it('Paso D · genera el informe ejecutivo gerencial con avance, vencimientos, bloqueos y pendientes de decisión', async () => {
    const informe = (
      await patrocinador.api.get(`/missions/${misionId}/executive-report`).expect(200)
    ).body as {
      disponible: boolean;
      mision: { estado: string; coordinadorAgentId: string | null };
      avance: { objetivos: number; totalTareas: number; contratosNegocio: number };
      compromisos: { tareaId: string; estado: string }[];
      vencimientos: { estado: string }[];
      bloqueos: { origen: string; tareaId: string | null }[];
      pendientesDecisionHumana: { tipo: string }[];
    };

    expect(informe.disponible).toBe(true);
    expect(informe.mision.estado).toBe('AUTORIZADA'); // el coordinador NO cambió el estado (no auto-ejecuta)
    expect(informe.mision.coordinadorAgentId).toBe(gerenteDigitalId);

    // Avance: el objetivo y las tres tareas vinculadas, con el contrato de negocio contado.
    expect(informe.avance.objetivos).toBe(1);
    expect(informe.avance.totalTareas).toBe(3);
    expect(informe.avance.contratosNegocio).toBe(1);

    // Compromisos y vencimientos: la tarea con plazo vencido aparece como VENCIDO.
    expect(informe.compromisos.some((c) => c.tareaId === tareaVencidaId && c.estado === 'VENCIDO')).toBe(true);
    expect(informe.vencimientos.length).toBeGreaterThanOrEqual(1);

    // Bloqueos: incumplimiento abierto + tarea bloqueada + dependencia vencida (derivados de E4).
    expect(informe.bloqueos.some((b) => b.origen === 'INCUMPLIMIENTO' && b.tareaId === tareaLegalId)).toBe(true);
    expect(informe.bloqueos.some((b) => b.origen === 'TAREA_BLOQUEADA' && b.tareaId === tareaLegalId)).toBe(true);
    expect(informe.bloqueos.some((b) => b.origen === 'DEPENDENCIA_VENCIDA' && b.tareaId === tareaVencidaId)).toBe(true);

    // Pendientes de decisión humana: las asignaciones propuestas + el escalamiento del bloqueo (bandeja E6).
    expect(informe.pendientesDecisionHumana.length).toBeGreaterThanOrEqual(3);
    expect(informe.pendientesDecisionHumana.some((p) => p.tipo === 'DECISION_HUMANA_SOLICITADA')).toBe(true);
  });

  // --- Paso E · TRAZABILIDAD: cada acción quedó auditada y la cadena por hash está íntegra (E13) ----------------------

  it('Paso E · verifica la trazabilidad: auditoría inmutable por acción y cadena de hash íntegra', async () => {
    // Cada capacidad del coordinador dejó su huella en la auditoría inmutable (E13).
    expect((await auditoria('MISION_COORDINADOR_ASIGNACION')).length).toBeGreaterThanOrEqual(2);
    expect((await auditoria('MISION_COORDINADOR_SUPERVISION')).length).toBeGreaterThanOrEqual(1);
    expect((await auditoria('MISION_COORDINADOR_SEGUIMIENTO')).length).toBeGreaterThanOrEqual(1);
    expect((await auditoria('MISION_COORDINADOR_BLOQUEO')).length).toBeGreaterThanOrEqual(1);
    expect((await auditoria('MISION_COORDINADOR_DECISION_SOLICITADA')).length).toBeGreaterThanOrEqual(1);
    expect((await auditoria('MISION_COORDINADOR_AUTOAPROBACION_BLOQUEADA')).length).toBeGreaterThanOrEqual(1);

    // La creación/autorización de la misión también quedó auditada (actos de gobierno humanos).
    expect((await auditoria('MISION_CREADA')).length).toBeGreaterThanOrEqual(1);
    expect((await auditoria('MISION_AUTORIZADA')).length).toBeGreaterThanOrEqual(1);

    // La cadena por hash del workspace sintético permanece íntegra: nadie alteró ni borró un hecho.
    const cadena = await audit.verificarCadena(patrocinador.workspaceId);
    expect(cadena.ok).toBe(true);
    expect(cadena.total).toBeGreaterThan(0);
  });

  it('Paso E2 · romper la cadena (manipulación) se DETECTA; se restaura y vuelve a quedar íntegra', async () => {
    // Prueba negativa de la inmutabilidad: alterar una entrada rompe la verificación en ese `seq`.
    const entrada = await prismaOf(app).auditLog.findFirst({
      where: { workspaceId: patrocinador.workspaceId, action: 'MISION_COORDINADOR_SUPERVISION' },
    });
    expect(entrada).not.toBeNull();
    const original = entrada!.resumen;
    await prismaOf(app).auditLog.update({
      where: { id: entrada!.id },
      data: { resumen: `${original} (manipulado)` },
    });
    const rota = await audit.verificarCadena(patrocinador.workspaceId);
    expect(rota.ok).toBe(false);
    expect(rota.rotaEnSeq).toBe(entrada!.seq);

    // Restaura el valor original para dejar la cadena íntegra (la demo no deja datos corruptos).
    await prismaOf(app).auditLog.update({ where: { id: entrada!.id }, data: { resumen: original } });
    const sana = await audit.verificarCadena(patrocinador.workspaceId);
    expect(sana.ok).toBe(true);
  });
});
