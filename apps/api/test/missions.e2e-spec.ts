import type { INestApplication } from '@nestjs/common';
import { Api, createTestApp, prismaOf } from './utils/app';
import { addMember, createAgent, registerOwner, rootUnit, type Session } from './utils/fixtures';

interface Mision {
  id: string;
  nombre: string;
  estado: 'PROPUESTA' | 'AUTORIZADA' | 'EN_CURSO' | 'EN_VALIDACION' | 'LOGRADA' | 'DETENIDA' | 'CANCELADA';
  coordinadorAgentId: string | null;
  autorizadaPorUserId: string | null;
  participantes: { id: string; orgUnitId: string; agenteLiderId: string | null }[];
  vinculos: { id: string; objetivoId: string | null; tareaId: string | null }[];
  seguimiento: {
    resumen: {
      totalTareas: number;
      tareasEnProduccion: number;
      tareasPresentadas: number;
      contratosNegocio: number;
      contratosNegocioAceptados: number;
      bloqueos: number;
    };
    bloqueos: { tareaId: string; titulo: string; motivo: string }[];
    estadoActual: string;
    estadoSugerido: string;
    puedeMarcarseLograda: boolean;
  };
}

/**
 * Misiones transversales (ADR 0016 · E3 · Incremento 1, backend). Verifica las invariantes duras del patrocinador:
 *  - Humano en el origen: una persona con nivel suficiente crea y autoriza; un agente (API key sin usuario) NO (403).
 *  - Coordinar/vincular/participar NO concede acceso (QA12): nombrar un agente no crea shares ni le abre datos.
 *  - Multi-tenant estricto: un workspace no ve ni toca las misiones de otro (404).
 *  - Transiciones verificables (D2): el estado solo avanza por la máquina; las transiciones ilegales dan 409.
 *  - Seguimiento agregado mínimo: estado del trabajo vinculado, bloqueos (quién frena) y propuesta de LOGRADA.
 *  - Auditoría (E13): crear/autorizar/detener/cancelar dejan entrada inmutable con actor humano.
 */
describe('Misiones transversales ADR 0016 (e2e)', () => {
  let app: INestApplication;
  let owner: Session;

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'mision-owner');
  });

  afterAll(async () => {
    await app.close();
  });

  async function crearMision(s: Session, nombre: string, extra: Record<string, unknown> = {}): Promise<Mision> {
    return (
      await s.api
        .post('/missions', { nombre, resultadoEsperado: 'Cerrar el ciclo de cobro del grupo este trimestre', ...extra })
        .expect(201)
    ).body as Mision;
  }

  /** Crea una API key ADMIN (actor máquina, proxy de "agente": sin `userId`). */
  async function adminApiKey(): Promise<Api> {
    const created = (
      await owner.api
        .post('/workspace/api-keys', { name: 'Agente integrador', scopes: ['read', 'write'], role: 'ADMIN' })
        .expect(201)
    ).body as { key: string };
    return new Api(app, created.key);
  }

  it('humano con nivel suficiente crea (PROPUESTA) y autoriza (AUTORIZADA)', async () => {
    const coord = await createAgent(owner, { name: 'Superempleado' });
    const m = await crearMision(owner, 'Cobro del grupo', { coordinadorAgentId: coord.id });
    expect(m.estado).toBe('PROPUESTA');
    expect(m.coordinadorAgentId).toBe(coord.id);
    expect(m.autorizadaPorUserId).toBeNull();

    const autorizada = (await owner.api.post(`/missions/${m.id}/authorize`, {}).expect(201)).body as Mision;
    expect(autorizada.estado).toBe('AUTORIZADA');
    expect(autorizada.autorizadaPorUserId).toBe(owner.userId);

    // Queda listada y legible.
    const lista = (await owner.api.get('/missions').expect(200)).body as Mision[];
    expect(lista.some((x) => x.id === m.id)).toBe(true);
  });

  it('autorizar exige coordinador asignado (400 si falta)', async () => {
    const m = await crearMision(owner, 'Sin coordinador');
    await owner.api.post(`/missions/${m.id}/authorize`, {}).expect(400);
    // Se puede fijar el coordinador al autorizar.
    const coord = await createAgent(owner, { name: 'Coordinador tardío' });
    const ok = (await owner.api.post(`/missions/${m.id}/authorize`, { coordinadorAgentId: coord.id }).expect(201))
      .body as Mision;
    expect(ok.estado).toBe('AUTORIZADA');
  });

  it('un agente (API key sin usuario) NO puede crear ni autorizar misiones (403, AGENTE_NO_CREA_AGENTES)', async () => {
    const agente = await adminApiKey();
    // La API key es ADMIN (pasa @MinRole) pero no tiene userId: el servicio exige humano en el origen.
    await agente
      .post('/missions', { nombre: 'Creada por agente', resultadoEsperado: 'Intento del agente' })
      .expect(403);

    // Tampoco puede autorizar una misión existente.
    const coord = await createAgent(owner, { name: 'Coord' });
    const m = await crearMision(owner, 'Para autorizar', { coordinadorAgentId: coord.id });
    await agente.post(`/missions/${m.id}/authorize`, {}).expect(403);

    // Y la misión sigue en PROPUESTA (el intento del agente no tuvo efecto).
    const leida = (await owner.api.get(`/missions/${m.id}`).expect(200)).body as Mision;
    expect(leida.estado).toBe('PROPUESTA');
  });

  it('roles: VIEWER/EDITOR no crean ni autorizan (403); ADMIN sí', async () => {
    const editor = await addMember(app, owner, { role: 'EDITOR', tag: 'mision-editor' });
    const viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'mision-viewer' });

    await viewer.api.post('/missions', { nombre: 'x', resultadoEsperado: 'x' }).expect(403);
    await editor.api.post('/missions', { nombre: 'x', resultadoEsperado: 'x' }).expect(403);

    const coord = await createAgent(owner, { name: 'Coord roles' });
    const m = await crearMision(owner, 'Gobernada por rol', { coordinadorAgentId: coord.id });
    // Un EDITOR puede gestionar participantes/vínculos, pero no autorizar.
    await editor.api.post(`/missions/${m.id}/authorize`, {}).expect(403);
    // Lectura disponible para cualquier miembro.
    await viewer.api.get(`/missions/${m.id}`).expect(200);
  });

  it('participar/vincular NO concede acceso (QA12): nombrar un agente no crea shares ni tools', async () => {
    const empresaB = (
      await owner.api.post('/admin/org/units', { name: 'Empresa B', parentId: (await rootUnit(owner)).id }).expect(201)
    ).body as { id: string };
    const lider = await createAgent(owner, { name: 'Líder de área' });
    const coord = await createAgent(owner, { name: 'Coordinador QA12' });
    const m = await crearMision(owner, 'Cruza empresas', { coordinadorAgentId: coord.id });

    // Objetivo y tarea reales de la empresa B, vinculados por referencia.
    const objetivo = await prismaOf(app).objetivo.create({
      data: {
        workspaceId: owner.workspaceId,
        codigo: `OBJ-${Date.now()}`,
        nombre: 'Recaudo B',
        orgUnitId: empresaB.id,
      },
    });

    const conPart = (
      await owner.api
        .post(`/missions/${m.id}/participants`, { orgUnitId: empresaB.id, agenteLiderId: lider.id })
        .expect(201)
    ).body as Mision;
    expect(conPart.participantes).toHaveLength(1);

    const conVinc = (await owner.api.post(`/missions/${m.id}/links`, { objetivoId: objetivo.id }).expect(201))
      .body as Mision;
    expect(conVinc.vinculos).toHaveLength(1);

    // Nombrar coordinador/líder y vincular el objetivo NO concede ningún acceso: ni shares ni tools para esos agentes.
    for (const agentId of [coord.id, lider.id]) {
      const shares = await prismaOf(app).agentShare.count({ where: { agentId } });
      const tools = await prismaOf(app).agentTool.count({ where: { agentId } });
      expect(shares).toBe(0);
      expect(tools).toBe(0);
    }
  });

  it('un vínculo debe referir al menos un objetivo o una tarea (400)', async () => {
    const m = await crearMision(owner, 'Vínculo vacío');
    await owner.api.post(`/missions/${m.id}/links`, {}).expect(400);
  });

  it('valida referencias por workspace: orgUnit/objetivo de otro tenant dan 404', async () => {
    const otro = await registerOwner(app, 'mision-otro');
    const objetivoAjeno = await prismaOf(app).objetivo.create({
      data: { workspaceId: otro.workspaceId, codigo: `AJENO-${Date.now()}`, nombre: 'Ajeno' },
    });
    const m = await crearMision(owner, 'Con referencias ajenas');
    await owner.api.post(`/missions/${m.id}/participants`, { orgUnitId: (await rootUnit(otro)).id }).expect(404);
    await owner.api.post(`/missions/${m.id}/links`, { objetivoId: objetivoAjeno.id }).expect(404);
  });

  it('aísla por workspace: otro workspace no ve ni toca la misión (404)', async () => {
    const coord = await createAgent(owner, { name: 'Coord aislada' });
    const m = await crearMision(owner, 'Privada del tenant', { coordinadorAgentId: coord.id });
    const otro = await registerOwner(app, 'mision-aisla');

    await otro.api.get(`/missions/${m.id}`).expect(404);
    await otro.api.post(`/missions/${m.id}/authorize`, {}).expect(404);
    await otro.api.post(`/missions/${m.id}/stop`, { motivo: 'intruso' }).expect(404);
    await otro.api.post(`/missions/${m.id}/participants`, { orgUnitId: (await rootUnit(otro)).id }).expect(404);
    const catalogo = (await otro.api.get('/missions').expect(200)).body as Mision[];
    expect(catalogo.some((x) => x.id === m.id)).toBe(false);
  });

  it('transiciones verificables (D2): camino válido y rechazo de transiciones ilegales (409)', async () => {
    const coord = await createAgent(owner, { name: 'Coord ciclo' });
    const m = await crearMision(owner, 'Ciclo de vida', { coordinadorAgentId: coord.id });

    await owner.api.post(`/missions/${m.id}/authorize`, {}).expect(201);
    // Re-autorizar una misión ya AUTORIZADA es un no-op ilegal (409).
    await owner.api.post(`/missions/${m.id}/authorize`, {}).expect(409);

    // Detener (motivo obligatorio) y luego cancelar.
    await owner.api.post(`/missions/${m.id}/stop`, {}).expect(400);
    const detenida = (await owner.api.post(`/missions/${m.id}/stop`, { motivo: 'dependencia vencida' }).expect(201))
      .body as Mision;
    expect(detenida.estado).toBe('DETENIDA');

    const cancelada = (await owner.api.post(`/missions/${m.id}/cancel`, { motivo: 'reorganización' }).expect(201))
      .body as Mision;
    expect(cancelada.estado).toBe('CANCELADA');

    // Desde CANCELADA (terminal) no se puede autorizar ni detener.
    await owner.api.post(`/missions/${m.id}/authorize`, {}).expect(409);
    await owner.api.post(`/missions/${m.id}/stop`, { motivo: 'reintento' }).expect(409);
  });

  it('seguimiento: detecta bloqueos (dependencia vencida) y propone LOGRADA solo con contratos ACEPTADO + confirmación', async () => {
    const coord = await createAgent(owner, { name: 'Coord seguimiento' });
    const m = await crearMision(owner, 'Seguimiento agregado', { coordinadorAgentId: coord.id });
    const prisma = prismaOf(app);

    // Tarea de negocio ACEPTADA (contrato aceptado) y tarea con dependencia vencida (bloqueo).
    const tareaOk = await prisma.tarea.create({
      data: { workspaceId: owner.workspaceId, titulo: 'Recaudo confirmado', estado: 'COMPLETADA' },
    });
    await prisma.contratoResultado.create({
      data: {
        workspaceId: owner.workspaceId,
        tareaId: tareaOk.id,
        resultadoEsperado: 'Cobro confirmado',
        tipoResultado: 'RESULTADO_NEGOCIO',
        estado: 'ACEPTADO',
      },
    });
    const tareaBloqueada = await prisma.tarea.create({
      data: {
        workspaceId: owner.workspaceId,
        titulo: 'Conciliación atrasada',
        estado: 'EN_EJECUCION',
        fechaLimite: new Date(Date.now() - 86_400_000),
      },
    });

    await owner.api.post(`/missions/${m.id}/links`, { tareaId: tareaOk.id }).expect(201);
    await owner.api.post(`/missions/${m.id}/links`, { tareaId: tareaBloqueada.id }).expect(201);

    const sinConfirmar = (await owner.api.get(`/missions/${m.id}`).expect(200)).body as Mision;
    expect(sinConfirmar.seguimiento.resumen.totalTareas).toBe(2);
    expect(sinConfirmar.seguimiento.resumen.contratosNegocio).toBe(1);
    expect(sinConfirmar.seguimiento.resumen.contratosNegocioAceptados).toBe(1);
    expect(sinConfirmar.seguimiento.bloqueos.some((b) => b.motivo === 'DEPENDENCIA_VENCIDA')).toBe(true);
    // Sin confirmación humana no se propone lograr, aunque el contrato de negocio esté aceptado (D5).
    expect(sinConfirmar.seguimiento.puedeMarcarseLograda).toBe(false);

    const confirmada = (await owner.api.get(`/missions/${m.id}?confirmarLograda=true`).expect(200)).body as Mision;
    expect(confirmada.seguimiento.puedeMarcarseLograda).toBe(true);
  });

  it('auditoría (E13): crear/autorizar/detener/cancelar dejan entrada con actor humano', async () => {
    const coord = await createAgent(owner, { name: 'Coord auditada' });
    const m = await crearMision(owner, 'Auditada', { coordinadorAgentId: coord.id });
    await owner.api.post(`/missions/${m.id}/authorize`, {}).expect(201);
    await owner.api.post(`/missions/${m.id}/stop`, { motivo: 'bloqueo' }).expect(201);
    await owner.api.post(`/missions/${m.id}/cancel`, { motivo: 'cierre' }).expect(201);

    const creada = (await owner.api.get(`/auditoria?action=MISION_CREADA&targetId=${m.id}`).expect(200)).body as {
      items: { actorType: string; actorId: string }[];
    };
    expect(creada.items).toHaveLength(1);
    expect(creada.items[0].actorType).toBe('USER');
    expect(creada.items[0].actorId).toBe(owner.userId);

    for (const action of ['MISION_AUTORIZADA', 'MISION_DETENIDA', 'MISION_CANCELADA']) {
      const r = (await owner.api.get(`/auditoria?action=${action}&targetId=${m.id}`).expect(200)).body as {
        items: unknown[];
      };
      expect(r.items).toHaveLength(1);
    }
  });
});
