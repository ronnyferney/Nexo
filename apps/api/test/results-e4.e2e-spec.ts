import type { INestApplication } from '@nestjs/common';
import { IncumplimientosService } from '../src/modules/results/incumplimientos.service';
import { createTestApp } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

/**
 * E4 · Trabajo por resultados (ADR 0012). Verifica: CRUD y aislamiento por workspace, VIEWER no muta, la invariante
 * verificador ≠ ejecutor (RF30), que una tarea solo se COMPLETA con el resultado ACEPTADO (HU15/QA09) y que un
 * incumplimiento se DECLARA al agotar el límite (RF31: nunca activo para siempre).
 */
describe('Resultados E4 (e2e)', () => {
  let app: INestApplication;
  let owner: Session;

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'e4-owner');
  });

  afterAll(async () => {
    await app.close();
  });

  /** Crea objetivo + tarea de negocio + contrato con regla determinista y evidencia exigida, y lo lleva a validación. */
  async function tareaConContratoEnValidacion(duenoUserId = 'dueno-ejecutor', ejecutorAgentId = 'agente-ejecutor') {
    const objetivo = (
      await owner.api
        .post('/objetivos', {
          codigo: `OBJ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          nombre: 'Recaudo Q4',
        })
        .expect(201)
    ).body as { id: string };

    const tarea = (
      await owner.api
        .post('/tareas', {
          titulo: 'Confirmar recaudo',
          objetivoId: objetivo.id,
          tipoResultado: 'RESULTADO_NEGOCIO',
          responsableAgentId: ejecutorAgentId,
          duenoUserId,
          criterioAceptacion: 'Recaudo confirmado por Tesorería',
        })
        .expect(201)
    ).body as { id: string };

    const contrato = (
      await owner.api
        .post(`/tareas/${tarea.id}/contrato`, {
          resultadoEsperado: 'Recaudo confirmado en el sistema financiero',
          tipoResultado: 'RESULTADO_NEGOCIO',
          responsableAgentId: ejecutorAgentId,
          duenoUserId,
          reglaValidacion: { rules: [{ left: '{{ recaudo.confirmado }}', operator: 'eq', right: true }] },
          evidenciaExigida: ['confirmacion_tesoreria'],
        })
        .expect(201)
    ).body as { id: string };

    await owner.api.post(`/contratos/${contrato.id}/comprometer`).expect(201);
    await owner.api.post(`/contratos/${contrato.id}/avanzar`, { estado: 'EN_PRODUCCION' }).expect(201);
    await owner.api.post(`/contratos/${contrato.id}/avanzar`, { estado: 'PENDIENTE_VALIDACION' }).expect(201);
    await owner.api
      .post(`/contratos/${contrato.id}/evidencias`, {
        tipo: 'confirmacion_tesoreria',
        referencia: { externalId: 'TX-1' },
      })
      .expect(201);
    // La tarea pasa a EN_EJECUCION (estado operativo), ortogonal al estado del resultado.
    await owner.api.post(`/tareas/${tarea.id}/estado`, { estado: 'EN_EJECUCION' }).expect(201);
    return { tareaId: tarea.id, contratoId: contrato.id };
  }

  it('crea objetivos y tareas y las lista', async () => {
    const obj = (
      await owner.api.post('/objetivos', { codigo: `OBJ-L-${Date.now()}`, nombre: 'Objetivo lista' }).expect(201)
    ).body as { id: string };
    await owner.api.post('/tareas', { titulo: 'Tarea lista', objetivoId: obj.id }).expect(201);
    const tareas = (await owner.api.get(`/tareas?objetivoId=${obj.id}`).expect(200)).body as unknown[];
    expect(tareas).toHaveLength(1);
  });

  it('rechaza que el ejecutor valide su propio resultado (verificador ≠ ejecutor, RF30)', async () => {
    const { contratoId } = await tareaConContratoEnValidacion();
    // Agente verificador = agente ejecutor.
    await owner.api
      .post(`/contratos/${contratoId}/validar`, {
        modo: 'ASISTIDA',
        verificadorAgentId: 'agente-ejecutor',
        critica: 'VEREDICTO: OK',
      })
      .expect(400);
    // Validador humano = dueño ejecutor.
    await owner.api
      .post(`/contratos/${contratoId}/validar`, {
        modo: 'HUMANA',
        validadorUserId: 'dueno-ejecutor',
        veredicto: 'ACEPTA',
      })
      .expect(400);
  });

  it('no completa la tarea sin resultado ACEPTADO, y sí la completa tras aceptarlo (HU15/QA09)', async () => {
    const { tareaId, contratoId } = await tareaConContratoEnValidacion();

    // El resultado está PENDIENTE_VALIDACION: completar la tarea debe fallar (resultado generado ≠ aceptado).
    await owner.api.post(`/tareas/${tareaId}/estado`, { estado: 'COMPLETADA' }).expect(400);

    // Verificación determinista superada: la regla se cumple y la evidencia exigida está presente.
    const val = (
      await owner.api
        .post(`/contratos/${contratoId}/validar`, { modo: 'DETERMINISTA', contexto: { recaudo: { confirmado: true } } })
        .expect(201)
    ).body as { estadoResultado: string };
    expect(val.estadoResultado).toBe('ACEPTADO');

    // Ahora sí se completa.
    const tarea = (await owner.api.post(`/tareas/${tareaId}/estado`, { estado: 'COMPLETADA' }).expect(201)).body as {
      estado: string;
    };
    expect(tarea.estado).toBe('COMPLETADA');
  });

  it('la verificación determinista devuelve el resultado cuando falta la evidencia exigida', async () => {
    const objetivo = (
      await owner.api.post('/objetivos', { codigo: `OBJ-D-${Date.now()}`, nombre: 'Sin evidencia' }).expect(201)
    ).body as { id: string };
    const tarea = (await owner.api.post('/tareas', { titulo: 'Sin evidencia', objetivoId: objetivo.id }).expect(201))
      .body as { id: string };
    const contrato = (
      await owner.api
        .post(`/tareas/${tarea.id}/contrato`, {
          resultadoEsperado: 'Documento emitido',
          reglaValidacion: { rules: [{ left: '{{ ok }}', operator: 'eq', right: true }] },
          evidenciaExigida: ['factura'],
        })
        .expect(201)
    ).body as { id: string };
    await owner.api.post(`/contratos/${contrato.id}/comprometer`).expect(201);
    await owner.api.post(`/contratos/${contrato.id}/avanzar`, { estado: 'EN_PRODUCCION' }).expect(201);
    await owner.api.post(`/contratos/${contrato.id}/avanzar`, { estado: 'PENDIENTE_VALIDACION' }).expect(201);
    // Regla cumple pero falta la evidencia 'factura': se devuelve.
    const val = (
      await owner.api
        .post(`/contratos/${contrato.id}/validar`, { modo: 'DETERMINISTA', contexto: { ok: true } })
        .expect(201)
    ).body as { estadoResultado: string };
    expect(val.estadoResultado).toBe('DEVUELTO_INCUMPLIDO');
  });

  it('declara el incumplimiento al agotar el límite de reintentos (RF31)', async () => {
    const objetivo = (
      await owner.api.post('/objetivos', { codigo: `OBJ-I-${Date.now()}`, nombre: 'Incumplimiento' }).expect(201)
    ).body as { id: string };
    const tarea = (await owner.api.post('/tareas', { titulo: 'Con límite', objetivoId: objetivo.id }).expect(201))
      .body as { id: string };
    const inc = (
      await owner.api
        .post(`/tareas/${tarea.id}/incumplimientos`, { causa: 'EVIDENCIA_INSUFICIENTE', maxReintentos: 1 })
        .expect(201)
    ).body as { id: string; resuelto: boolean };
    expect(inc.resuelto).toBe(false);

    // Un intento alcanza el límite (maxReintentos=1): se declara y la tarea se bloquea.
    const declarado = (await owner.api.post(`/incumplimientos/${inc.id}/intento`, {}).expect(201)).body as {
      resuelto: boolean;
      resolucion: string;
    };
    expect(declarado.resuelto).toBe(true);
    expect(declarado.resolucion).toBe('LIMITE_AGOTADO');

    const tareaView = (await owner.api.get(`/tareas/${tarea.id}`).expect(200)).body as { estado: string };
    expect(tareaView.estado).toBe('BLOQUEADA');
  });

  it('el barrido de vencimientos abre un incumplimiento para tareas con plazo vencido (cron de reconciliación)', async () => {
    const tarea = (
      await owner.api
        .post('/tareas', { titulo: 'Vencida', fechaLimite: new Date(Date.now() - 60_000).toISOString() })
        .expect(201)
    ).body as { id: string };

    const sweeper = app.get(IncumplimientosService);
    const stats = await sweeper.barrer(new Date(), owner.workspaceId);
    expect(stats.abiertos).toBeGreaterThanOrEqual(1);

    const incs = (await owner.api.get(`/tareas/${tarea.id}/incumplimientos`).expect(200)).body as { causa: string }[];
    expect(incs.some((i) => i.causa === 'PLAZO_VENCIDO')).toBe(true);
  });

  it('aísla por workspace: otro workspace no ve ni edita las tareas', async () => {
    const { tareaId } = await tareaConContratoEnValidacion();
    const otro = await registerOwner(app, 'e4-otro');
    await otro.api.get(`/tareas/${tareaId}`).expect(404);
    await otro.api.post(`/tareas/${tareaId}/estado`, { estado: 'BLOQUEADA' }).expect(404);
  });

  it('un VIEWER no puede mutar (crea/edita)', async () => {
    const viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'e4-viewer' });
    await viewer.api.post('/objetivos', { codigo: `OBJ-V-${Date.now()}`, nombre: 'No permitido' }).expect(403);
    await viewer.api.post('/tareas', { titulo: 'No permitido' }).expect(403);
    // Pero sí puede leer.
    await viewer.api.get('/objetivos').expect(200);
  });
});
