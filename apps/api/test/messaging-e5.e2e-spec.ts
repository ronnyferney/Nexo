import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { MensajesService } from '../src/modules/messaging/mensajes.service';
import { createTestApp } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

/**
 * E5 · Comunicación entre agentes + handoff + control de delegación (ADR 0012 D3/D4). Verifica: idempotencia del
 * protocolo (QA11: una redelivery no crea otra tarea), que un mensaje no amplía atribuciones (RF09/QA02), que la
 * delegación se detiene por profundidad/ciclo (RF10/QA10), que un handoff aceptado continúa desde el estado persistido
 * sin rehacer y uno rechazado devuelve (RF09/RF33), la suplencia/escalamiento por falta de respuesta (HU17) y el
 * aislamiento por workspace. Coordinación (RF36): una solicitud se convierte en tarea autorizada; mención sin acceso.
 */
describe('Mensajería y handoff E5 (e2e)', () => {
  let app: INestApplication;
  let owner: Session;

  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'e5-owner');
  });

  afterAll(async () => {
    await app.close();
  });

  async function crearWorkflowMinimo(): Promise<string> {
    const def = { nodes: [{ id: 't', type: 'trigger', name: 'Inicio', config: {} }], edges: [] };
    return (
      (await owner.api.post('/workflows', { name: `WF ${uid()}`, definition: def }).expect(201)).body as { id: string }
    ).id;
  }

  it('redelivery del mismo messageId NO crea otra tarea (idempotencia, QA11)', async () => {
    const messageId = `asig-${uid()}`;
    const dto = {
      messageId,
      tipo: 'ASIGNACION',
      destinatarioAgentId: 'agente-b',
      tarea: { titulo: 'Preparar informe' },
    };
    const primera = (await owner.api.post('/mensajes', dto).expect(201)).body as { id: string; tareaId: string };
    expect(primera.tareaId).toBeTruthy();

    // Misma clave: redelivery. Devuelve el mismo mensaje y la MISMA tarea, sin crear otra.
    const segunda = (await owner.api.post('/mensajes', dto).expect(201)).body as { id: string; tareaId: string };
    expect(segunda.id).toBe(primera.id);
    expect(segunda.tareaId).toBe(primera.tareaId);

    const prisma = app.get(PrismaService);
    const tareas = await prisma.tarea.count({ where: { workspaceId: owner.workspaceId, titulo: 'Preparar informe' } });
    expect(tareas).toBe(1);
  });

  it('un mensaje NO amplía atribuciones: permisos de autoaprobación/presupuesto se rechazan (RF09/QA02)', async () => {
    await owner.api
      .post('/mensajes', { messageId: `amp-${uid()}`, tipo: 'ASIGNACION', permisos: { ampliarPresupuesto: true } })
      .expect(403);
    await owner.api
      .post('/mensajes', { messageId: `amp-${uid()}`, tipo: 'SOLICITUD_INFO', permisos: { crearAgentes: true } })
      .expect(403);
  });

  it('la delegación se detiene al detectar un ciclo de responsables (RF10/QA10)', async () => {
    // Cadena: tarea raíz con responsable 'agente-x'. Asignar de nuevo a 'agente-x' como subtarea = ciclo.
    const raiz = (
      await owner.api.post('/tareas', { titulo: `Raíz ${uid()}`, responsableAgentId: 'agente-x' }).expect(201)
    ).body as { id: string };

    await owner.api
      .post('/mensajes', {
        messageId: `ciclo-${uid()}`,
        tipo: 'ASIGNACION',
        destinatarioAgentId: 'agente-x',
        tarea: { titulo: 'Subtarea cíclica', parentTareaId: raiz.id },
      })
      .expect(400);
  });

  it('handoff aceptado continúa desde el estado persistido SIN rehacer; rechazado devuelve (RF09/RF33)', async () => {
    const workflowId = await crearWorkflowMinimo();
    const tarea = (
      await owner.api.post('/tareas', { titulo: `Proceso ${uid()}`, responsableAgentId: 'agente-1' }).expect(201)
    ).body as { id: string };

    // Punto de corte: se propone un handoff con el estado alcanzado y el flujo del segmento entrante.
    const transferencia = (
      await owner.api
        .post(`/tareas/${tarea.id}/handoff`, {
          messageId: `handoff-${uid()}`,
          fromAgentId: 'agente-1',
          toAgentId: 'agente-2',
          estadoAlcanzado: { pasoConfirmado: 'cobro-emitido', monto: 100 },
          criterioSiguiente: 'Confirmar recaudo en Tesorería',
          workflowId,
        })
        .expect(201)
    ).body as { id: string; secuenciaSegmento: number; estado: string };
    expect(transferencia.estado).toBe('PROPUESTO');
    expect(transferencia.secuenciaSegmento).toBe(1);

    // El receptor acepta: encola el siguiente segmento con el estado persistido como entrada.
    const aceptada = (
      await owner.api
        .post(`/transferencias/${transferencia.id}/aceptar`, { messageId: `acc-${uid()}`, aceptaAgentId: 'agente-2' })
        .expect(201)
    ).body as { estado: string; executionId: string | null };
    expect(aceptada.estado).toBe('ACEPTADO');
    expect(aceptada.executionId).toBeTruthy();

    const prisma = app.get(PrismaService);
    const execution = await prisma.execution.findUnique({ where: { id: aceptada.executionId! } });
    expect(execution?.tareaId).toBe(tarea.id);
    expect(execution?.secuenciaSegmento).toBe(1);
    // El estado persistido ES la entrada del segmento entrante: no se rehace el trabajo confirmado.
    expect(
      (execution?.input as { estadoAlcanzado?: { pasoConfirmado?: string } })?.estadoAlcanzado?.pasoConfirmado,
    ).toBe('cobro-emitido');

    // La tarea pasó al responsable entrante (trazabilidad de quién continúa).
    const tareaView = await prisma.tarea.findUnique({ where: { id: tarea.id } });
    expect(tareaView?.responsableAgentId).toBe('agente-2');

    // Aceptar de nuevo NO duplica (idempotencia por estado).
    await owner.api.post(`/transferencias/${transferencia.id}/aceptar`, { messageId: `acc2-${uid()}` }).expect(400);

    // Un segundo handoff (segmento 2) se puede rechazar: devuelve sin encolar nada.
    const t2 = (
      await owner.api
        .post(`/tareas/${tarea.id}/handoff`, {
          messageId: `handoff2-${uid()}`,
          fromAgentId: 'agente-2',
          toAgentId: 'agente-3',
          estadoAlcanzado: { pasoConfirmado: 'recaudo' },
        })
        .expect(201)
    ).body as { id: string; secuenciaSegmento: number };
    expect(t2.secuenciaSegmento).toBe(2);
    const rechazada = (
      await owner.api
        .post(`/transferencias/${t2.id}/rechazar`, { messageId: `rej-${uid()}`, motivo: 'Fuera de mi alcance' })
        .expect(201)
    ).body as { estado: string; motivoRechazo: string };
    expect(rechazada.estado).toBe('RECHAZADO');
    expect(rechazada.motivoRechazo).toBe('Fuera de mi alcance');
  });

  it('falta de respuesta a tiempo → escalamiento (suplencia/escalamiento, HU17)', async () => {
    const messageId = `venc-${uid()}`;
    const correlationId = `corr-${uid()}`;
    await owner.api
      .post('/mensajes', {
        messageId,
        tipo: 'SOLICITUD_INFO',
        correlationId,
        destinatarioAgentId: 'agente-lento',
        fechaLimite: new Date(Date.now() - 60_000).toISOString(),
      })
      .expect(201);

    const sweeper = app.get(MensajesService);
    const stats = await sweeper.barrerVencidos(new Date(), owner.workspaceId);
    expect(stats.vencidos).toBeGreaterThanOrEqual(1);
    expect(stats.escalados).toBeGreaterThanOrEqual(1);

    const escalados = (await owner.api.get(`/mensajes?correlationId=${correlationId}`).expect(200)).body as {
      tipo: string;
    }[];
    expect(escalados.some((m) => m.tipo === 'ESCALAMIENTO')).toBe(true);

    // Idempotente: un segundo barrido no vuelve a escalar el mismo mensaje.
    const segundo = await sweeper.barrerVencidos(new Date(), owner.workspaceId);
    expect(segundo.vencidos).toBe(0);
  });

  it('coordinación (RF36): una solicitud de un hilo se convierte en tarea autorizada (idempotente)', async () => {
    const canal = (await owner.api.post('/canales', { tipo: 'MISION', nombre: `Misión ${uid()}` }).expect(201))
      .body as { id: string };
    const hilo = (await owner.api.post(`/canales/${canal.id}/hilos`, { asunto: 'Necesitamos un informe' }).expect(201))
      .body as { id: string };

    const tarea = (
      await owner.api.post(`/hilos/${hilo.id}/convertir-en-tarea`, { titulo: 'Informe trimestral' }).expect(201)
    ).body as { id: string };
    expect(tarea.id).toBeTruthy();

    // Idempotente: convertir de nuevo devuelve la MISMA tarea (no crea otra).
    const otra = (await owner.api.post(`/hilos/${hilo.id}/convertir-en-tarea`, { titulo: 'Otra vez' }).expect(201))
      .body as { id: string };
    expect(otra.id).toBe(tarea.id);
  });

  it('aísla por workspace: otro workspace no ve ni acepta transferencias/mensajes (QA12)', async () => {
    const workflowId = await crearWorkflowMinimo();
    const tarea = (await owner.api.post('/tareas', { titulo: `Aislada ${uid()}` }).expect(201)).body as { id: string };
    const msg = (
      await owner.api.post('/mensajes', { messageId: `iso-${uid()}`, tipo: 'ENTREGA', tareaId: tarea.id }).expect(201)
    ).body as { id: string };
    const transferencia = (
      await owner.api
        .post(`/tareas/${tarea.id}/handoff`, { messageId: `isohd-${uid()}`, toAgentId: 'x', workflowId })
        .expect(201)
    ).body as { id: string };

    const otro = await registerOwner(app, 'e5-otro');
    await otro.api.get(`/mensajes/${msg.id}`).expect(404);
    await otro.api.post(`/transferencias/${transferencia.id}/aceptar`, { messageId: `h-${uid()}` }).expect(404);
    // La tarea pertenece a otro workspace: el listado de transferencias del otro workspace no la ve.
    const vistas = (await otro.api.get(`/tareas/${tarea.id}/transferencias`).expect(200)).body as unknown[];
    expect(vistas).toHaveLength(0);
  });

  it('un VIEWER no puede mutar mensajes ni canales', async () => {
    const viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'e5-viewer' });
    await viewer.api.post('/mensajes', { messageId: `v-${uid()}`, tipo: 'SOLICITUD_INFO' }).expect(403);
    await viewer.api.post('/canales', { tipo: 'AREA', nombre: 'No permitido' }).expect(403);
    // Pero sí puede leer.
    await viewer.api.get('/mensajes').expect(200);
    await viewer.api.get('/canales').expect(200);
  });
});
