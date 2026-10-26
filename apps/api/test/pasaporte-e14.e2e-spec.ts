import type { INestApplication } from '@nestjs/common';
import { createTestApp, prismaOf } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

interface Pasaporte {
  id: string;
  contratoResultadoId: string;
  tareaId: string | null;
  documentHash: string;
  auditSeq: number;
  auditEntryId: string;
  reemplazaAId: string | null;
  emitidoPorUserId: string | null;
}

interface VerifyResult {
  ok: boolean;
  motivo?: string;
  emitidoEl: string;
  ancla: { auditSeq: number; auditEntryId: string; hash: string | null };
}

interface ExportResult {
  pasaporte: { id: string; contratoResultadoId: string };
  documentoRef: Record<string, unknown>;
  documentHash: string;
  ancla: { auditSeq: number; auditEntryId: string; auditHash: string | null };
  instrucciones: { algoritmo: string; descripcion: string };
}

/**
 * E14 · Pasaporte de resultado (ADR 0014, Incremento 1). Verifica: la emisión sobre un `ContratoResultado` ACEPTADO
 * produce un pasaporte con `documentHash` determinista y una entrada PASAPORTE_EMITIDO en la auditoría (anclaje E13);
 * `verify` da ok recién emitido y DETECTA (a) alteración de una referencia subyacente, (b) manipulación directa de la
 * fila del pasaporte/ancla, (c) rotura de la cadena de auditoría; emitir sobre un contrato NO aceptado falla (409);
 * aislamiento multi-tenant (otro workspace -> 404); y la reemisión append-only crea un pasaporte nuevo con `reemplazaAId`.
 */
describe('Pasaporte de resultado E14 (e2e)', () => {
  let app: INestApplication;
  let owner: Session;

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'e14-owner');
  });

  afterAll(async () => {
    await app.close();
  });

  /** Crea un contrato de resultado con regla determinista + evidencia, y lo lleva hasta PENDIENTE_VALIDACION. */
  async function contratoEnValidacion(s: Session, ejecutorAgentId = 'agente-ejecutor', duenoUserId = 'dueno-ejecutor') {
    const objetivo = (
      await s.api.post('/objetivos', { codigo: `OBJ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, nombre: 'Recaudo' }).expect(201)
    ).body as { id: string };
    const tarea = (
      await s.api
        .post('/tareas', {
          titulo: 'Confirmar recaudo',
          objetivoId: objetivo.id,
          tipoResultado: 'RESULTADO_NEGOCIO',
          responsableAgentId: ejecutorAgentId,
          duenoUserId,
          criterioAceptacion: 'Recaudo confirmado',
        })
        .expect(201)
    ).body as { id: string };
    const contrato = (
      await s.api
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
    await s.api.post(`/contratos/${contrato.id}/comprometer`).expect(201);
    await s.api.post(`/contratos/${contrato.id}/avanzar`, { estado: 'EN_PRODUCCION' }).expect(201);
    await s.api.post(`/contratos/${contrato.id}/avanzar`, { estado: 'PENDIENTE_VALIDACION' }).expect(201);
    await s.api
      .post(`/contratos/${contrato.id}/evidencias`, { tipo: 'confirmacion_tesoreria', referencia: { externalId: 'TX-1' } })
      .expect(201);
    return { tareaId: tarea.id, contratoId: contrato.id };
  }

  /** Lleva el contrato a ACEPTADO con verificación determinista (regla cumple + evidencia presente). */
  async function contratoAceptado(s: Session) {
    const { tareaId, contratoId } = await contratoEnValidacion(s);
    const val = (
      await s.api
        .post(`/contratos/${contratoId}/validar`, { modo: 'DETERMINISTA', contexto: { recaudo: { confirmado: true } } })
        .expect(201)
    ).body as { estadoResultado: string };
    expect(val.estadoResultado).toBe('ACEPTADO');
    return { tareaId, contratoId };
  }

  it('emite un pasaporte de un contrato ACEPTADO con documentHash y entrada PASAPORTE_EMITIDO anclada', async () => {
    const { contratoId } = await contratoAceptado(owner);
    const p = (await owner.api.post(`/contracts/${contratoId}/passport`).expect(201)).body as Pasaporte;

    expect(p.contratoResultadoId).toBe(contratoId);
    expect(p.documentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(p.auditSeq).toBeGreaterThanOrEqual(1);
    expect(p.emitidoPorUserId).toBe(owner.userId);
    expect(p.reemplazaAId).toBeNull();

    // La entrada de auditoría ancla el pasaporte: misma seq, acción PASAPORTE_EMITIDO, targetId = id del pasaporte.
    const entry = await prismaOf(app).auditLog.findFirst({ where: { id: p.auditEntryId, workspaceId: owner.workspaceId } });
    expect(entry?.seq).toBe(p.auditSeq);
    expect(entry?.action).toBe('PASAPORTE_EMITIDO');
    expect(entry?.targetType).toBe('PasaporteResultado');
    expect(entry?.targetId).toBe(p.id);
    expect((entry?.metadata as { documentHash?: string }).documentHash).toBe(p.documentHash);

    // La lectura devuelve el mismo documento; verify da ok recién emitido.
    const leido = (await owner.api.get(`/passports/${p.id}`).expect(200)).body as Pasaporte;
    expect(leido.documentHash).toBe(p.documentHash);

    const v = (await owner.api.get(`/passports/${p.id}/verify`).expect(200)).body as VerifyResult;
    expect(v.ok).toBe(true);
    expect(v.motivo).toBeUndefined();
    expect(v.ancla.auditSeq).toBe(p.auditSeq);
    expect(v.ancla.hash).toBe(entry?.hash);
  });

  it('el export entrega el cuerpo canónico + ancla + instrucciones para recomputar sin datos sensibles', async () => {
    const { contratoId } = await contratoAceptado(owner);
    const p = (await owner.api.post(`/contracts/${contratoId}/passport`).expect(201)).body as Pasaporte;

    const ex = (await owner.api.get(`/passports/${p.id}/export`).expect(200)).body as ExportResult;
    expect(ex.documentHash).toBe(p.documentHash);
    expect(ex.pasaporte.id).toBe(p.id);
    expect(ex.ancla.auditSeq).toBe(p.auditSeq);
    expect(ex.instrucciones.algoritmo).toContain('sha256');
    // El cuerpo solo expone referencias + hashes (ids/hashes), nunca contenidos sensibles.
    expect(ex.documentoRef).toHaveProperty('validaciones');
    expect(ex.documentoRef).toHaveProperty('totales');
  });

  it('verify DETECTA la alteración de una referencia subyacente (p. ej. el veredicto de una validación)', async () => {
    const { contratoId } = await contratoAceptado(owner);
    const p = (await owner.api.post(`/contracts/${contratoId}/passport`).expect(201)).body as Pasaporte;
    expect(((await owner.api.get(`/passports/${p.id}/verify`).expect(200)).body as VerifyResult).ok).toBe(true);

    // Alteración directa en BD de una referencia (lo que detectaría la recomputación del documentHash).
    const val = await prismaOf(app).validacionResultado.findFirst({ where: { contratoResultadoId: contratoId } });
    await prismaOf(app).validacionResultado.update({ where: { id: val!.id }, data: { motivo: 'MOTIVO_MANIPULADO' } });

    const v = (await owner.api.get(`/passports/${p.id}/verify`).expect(200)).body as VerifyResult;
    expect(v.ok).toBe(false);
    expect(v.motivo).toBe('REFERENCIA_ALTERADA');
  });

  it('verify DETECTA la manipulación directa de la fila del pasaporte / su ancla', async () => {
    const { contratoId } = await contratoAceptado(owner);
    const p = (await owner.api.post(`/contracts/${contratoId}/passport`).expect(201)).body as Pasaporte;

    // Repuntar el ancla a otra seq (sin tocar referencias): la comprobación de ancla debe fallar.
    await prismaOf(app).pasaporteResultado.update({ where: { id: p.id }, data: { auditSeq: p.auditSeq + 1000 } });

    const v = (await owner.api.get(`/passports/${p.id}/verify`).expect(200)).body as VerifyResult;
    expect(v.ok).toBe(false);
    expect(v.motivo).toBe('ANCLA_NO_CUADRA');
  });

  it('verify DETECTA la rotura de la cadena de auditoría del workspace', async () => {
    // Workspace propio para no contaminar la cadena de los demás casos.
    const ws = await registerOwner(app, 'e14-cadena');
    const { contratoId } = await contratoAceptado(ws);
    const p = (await ws.api.post(`/contracts/${contratoId}/passport`).expect(201)).body as Pasaporte;
    expect(((await ws.api.get(`/passports/${p.id}/verify`).expect(200)).body as VerifyResult).ok).toBe(true);

    // Sabotaje de una entrada temprana de la cadena del workspace: verificarCadena lo detecta.
    const primera = await prismaOf(app).auditLog.findFirst({ where: { workspaceId: ws.workspaceId, seq: 1 } });
    await prismaOf(app).auditLog.update({ where: { id: primera!.id }, data: { resumen: 'CADENA MANIPULADA' } });

    const v = (await ws.api.get(`/passports/${p.id}/verify`).expect(200)).body as VerifyResult;
    expect(v.ok).toBe(false);
    expect(v.motivo).toBe('CADENA_CONTENIDO_ALTERADO');
  });

  it('rechaza emitir sobre un contrato NO aceptado (409) y sobre uno inexistente (404)', async () => {
    const { contratoId } = await contratoEnValidacion(owner); // queda en PENDIENTE_VALIDACION
    await owner.api.post(`/contracts/${contratoId}/passport`).expect(409);
    await owner.api.post('/contracts/contrato-inexistente/passport').expect(404);
  });

  it('aísla por workspace: otro workspace no ve ni verifica el pasaporte (404) ni puede emitirlo', async () => {
    const { contratoId } = await contratoAceptado(owner);
    const p = (await owner.api.post(`/contracts/${contratoId}/passport`).expect(201)).body as Pasaporte;

    const otro = await registerOwner(app, 'e14-otro');
    await otro.api.get(`/passports/${p.id}`).expect(404);
    await otro.api.get(`/passports/${p.id}/verify`).expect(404);
    await otro.api.get(`/passports/${p.id}/export`).expect(404);
    // El contrato tampoco es visible para el otro workspace al intentar emitir.
    await otro.api.post(`/contracts/${contratoId}/passport`).expect(404);
  });

  it('un VIEWER puede verificar/exportar pero no emitir (EDITOR+)', async () => {
    const { contratoId } = await contratoAceptado(owner);
    const p = (await owner.api.post(`/contracts/${contratoId}/passport`).expect(201)).body as Pasaporte;
    const viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'e14-viewer' });

    await viewer.api.post(`/contracts/${contratoId}/passport`).expect(403);
    const v = (await viewer.api.get(`/passports/${p.id}/verify`).expect(200)).body as VerifyResult;
    expect(v.ok).toBe(true);
    await viewer.api.get(`/passports/${p.id}/export`).expect(200);
  });

  it('append-only: reemitir tras un cambio en lo referenciado crea un pasaporte nuevo con reemplazaAId', async () => {
    const { tareaId, contratoId } = await contratoAceptado(owner);
    const p1 = (await owner.api.post(`/contracts/${contratoId}/passport`).expect(201)).body as Pasaporte;

    // Reemitir sin cambios es un no-op rechazado (mismo documentHash -> unicidad): la hoja de vida no se duplica.
    await owner.api.post(`/contracts/${contratoId}/passport`).expect(409);

    // Simula que el runtime registró una ejecución nueva para la tarea (correción/reapertura): cambia lo referenciado.
    const wf = await prismaOf(app).workflow.create({
      data: { workspaceId: owner.workspaceId, name: 'wf-e14', definition: {} },
    });
    await prismaOf(app).execution.create({
      data: { workspaceId: owner.workspaceId, workflowId: wf.id, tareaId, status: 'SUCCEEDED' },
    });

    const p2 = (await owner.api.post(`/contracts/${contratoId}/passport`).expect(201)).body as Pasaporte;
    expect(p2.id).not.toBe(p1.id);
    expect(p2.documentHash).not.toBe(p1.documentHash);
    expect(p2.reemplazaAId).toBe(p1.id);

    // El pasaporte anterior sigue existiendo (append-only), no se reescribió.
    const leido1 = (await owner.api.get(`/passports/${p1.id}`).expect(200)).body as Pasaporte;
    expect(leido1.documentHash).toBe(p1.documentHash);
  });
});
