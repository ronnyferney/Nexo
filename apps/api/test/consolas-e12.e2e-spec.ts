import type { INestApplication } from '@nestjs/common';
import { AuditService } from '../src/modules/audit/audit.service';
import { createTestApp, prismaOf } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

/**
 * E12 · Consola gerencial (vista ejecutiva para dirección). Solo lectura. Verifica que la consola AGREGA sobre datos ya
 * existentes sin reimplementar nada: resultados (E10), economía (E9), estado operativo de gobierno/durabilidad (E6/E7) e
 * integridad de auditoría (E13). Comprueba que los números cuadran con las fuentes sembradas, el aislamiento multi-tenant
 * (otro workspace no ve los conteos ajenos) y el rol (un VIEWER no accede a una consola de dirección).
 */
describe('Consola gerencial E12 (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  interface Consola {
    periodo: { from: string; to: string };
    alcance: { empresaId: string | null; areaId: string | null; agentId: string | null };
    resultados: {
      cumplimiento: { numerador: number; denominador: number; pct: number | null };
      calidad: { numerador: number; denominador: number; pct: number | null };
      costoPorResultado: { resultadosAceptados: number; costoTotalUsd: number };
    };
    economia: {
      costoAtribuibleUsd: number;
      consolidado: { dimension: string; totalMedidoUsd: number; totalEstimadoUsd: number; grupos: unknown[] } | null;
      consolidadoCausa: string | null;
    };
    gobierno: { aprobacionesPendientes: number; suspensionesActivas: number; excepcionesAbiertas: number };
    auditoria: { hechosEnPeriodo: number; totalHechos: number; cadenaIntegra: boolean };
  }

  async function consola(s: Session, from: Date, to: Date): Promise<Consola> {
    const qs = `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
    const res = await s.api.get(`/consolas/gerencial?${qs}`).expect(200);
    return res.body as Consola;
  }

  /** Crea objetivo + tarea + contrato determinista y lo deja ACEPTADO a tiempo (resultado real para los KPIs de E10). */
  async function resultadoAceptado(s: Session, fechaLimite: Date): Promise<void> {
    const suf = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const objetivo = (await s.api.post('/objetivos', { codigo: `OBJ-${suf}`, nombre: 'Recaudo' }).expect(201)).body as {
      id: string;
    };
    const tarea = (
      await s.api
        .post('/tareas', {
          titulo: 'Confirmar recaudo',
          objetivoId: objetivo.id,
          tipoResultado: 'RESULTADO_NEGOCIO',
          responsableAgentId: 'agente-ejecutor',
          duenoUserId: 'dueno-ejecutor',
          fechaLimite: fechaLimite.toISOString(),
        })
        .expect(201)
    ).body as { id: string };
    const contrato = (
      await s.api
        .post(`/tareas/${tarea.id}/contrato`, {
          resultadoEsperado: 'Recaudo confirmado',
          tipoResultado: 'RESULTADO_NEGOCIO',
          responsableAgentId: 'agente-ejecutor',
          duenoUserId: 'dueno-ejecutor',
          reglaValidacion: { rules: [{ left: '{{ ok }}', operator: 'eq', right: true }] },
          evidenciaExigida: ['factura'],
        })
        .expect(201)
    ).body as { id: string };
    await s.api.post(`/contratos/${contrato.id}/comprometer`).expect(201);
    await s.api.post(`/contratos/${contrato.id}/avanzar`, { estado: 'EN_PRODUCCION' }).expect(201);
    await s.api.post(`/contratos/${contrato.id}/avanzar`, { estado: 'PENDIENTE_VALIDACION' }).expect(201);
    await s.api
      .post(`/contratos/${contrato.id}/evidencias`, { tipo: 'factura', referencia: { externalId: 'TX-1' } })
      .expect(201);
    const val = (
      await s.api
        .post(`/contratos/${contrato.id}/validar`, { modo: 'DETERMINISTA', contexto: { ok: true } })
        .expect(201)
    ).body as { estadoResultado: string };
    expect(val.estadoResultado).toBe('ACEPTADO');
  }

  /** Siembra el estado operativo de gobierno/durabilidad directamente en la BD (fuentes de otras cédulas). */
  async function sembrarGobierno(workspaceId: string): Promise<void> {
    const prisma = prismaOf(app);
    // Excepciones: 2 abiertas + 1 cerrada → excepcionesAbiertas === 2.
    await prisma.excepcion.create({ data: { workspaceId, causa: 'Fallo motor 1', estado: 'ABIERTA' } });
    await prisma.excepcion.create({ data: { workspaceId, causa: 'Fallo motor 2', estado: 'EN_PROGRESO' } });
    await prisma.excepcion.create({ data: { workspaceId, causa: 'Fallo motor 3', estado: 'CANCELADA' } });
    // Suspensiones: 1 activa + 1 inactiva → suspensionesActivas === 1.
    await prisma.suspension.create({
      data: { workspaceId, alcance: 'AGENTE', targetId: 'agente-x', motivo: 'Emergencia', activa: true },
    });
    await prisma.suspension.create({
      data: { workspaceId, alcance: 'PROCESO', targetId: 'proceso-y', motivo: 'Resuelta', activa: false },
    });
    // Aprobaciones: 1 pendiente + 1 aprobada → aprobacionesPendientes === 1.
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.aprobacion.create({
      data: { workspaceId, tipoAccion: 'EMAIL_SEND', contentHash: 'h-pend', estado: 'PENDIENTE', expiresAt },
    });
    await prisma.aprobacion.create({
      data: { workspaceId, tipoAccion: 'EMAIL_SEND', contentHash: 'h-aprob', estado: 'APROBADA', expiresAt },
    });
  }

  it('agrega resultados + economía + gobierno + auditoría y los números cuadran con las fuentes', async () => {
    const owner = await registerOwner(app, 'e12-ok');
    const from = new Date(Date.now() - 60 * 60 * 1000); // -1h
    const to = new Date(Date.now() + 2 * 60 * 60 * 1000); // +2h

    // Resultado aceptado a tiempo (E10).
    await resultadoAceptado(owner, new Date(Date.now() + 60 * 60 * 1000));
    // Estado operativo de gobierno/durabilidad (E6/E7).
    await sembrarGobierno(owner.workspaceId);
    // Hechos de auditoría (E13): 3 appends → cadena íntegra y cuenta exacta en un workspace fresco.
    const audit = app.get(AuditService);
    for (let i = 0; i < 3; i++) {
      await audit.append(owner.workspaceId, {
        actorType: 'SYSTEM',
        action: 'ACCESO_SENSIBLE',
        resumen: `Hecho ${i}`,
      });
    }

    const c = await consola(owner, from, to);

    // Resultados (E10): 1 vencimiento aceptado a tiempo, 1 revisado sin corrección, 1 aceptado para costo.
    expect(c.resultados.cumplimiento.denominador).toBe(1);
    expect(c.resultados.cumplimiento.numerador).toBe(1);
    expect(c.resultados.cumplimiento.pct).toBe(100);
    expect(c.resultados.calidad.pct).toBe(100);
    expect(c.resultados.costoPorResultado.resultadosAceptados).toBe(1);

    // Economía (E9): sin consumo → costo 0; libro consolidado presente (alcance consolidable, sin área/agente).
    expect(c.economia.costoAtribuibleUsd).toBe(0);
    expect(c.economia.consolidado).not.toBeNull();
    expect(c.economia.consolidado!.dimension).toBe('empresa');
    expect(c.economia.consolidadoCausa).toBeNull();

    // Gobierno (E6/E7): conteos de estado operativo actual.
    expect(c.gobierno.aprobacionesPendientes).toBe(1);
    expect(c.gobierno.suspensionesActivas).toBe(1);
    expect(c.gobierno.excepcionesAbiertas).toBe(2);

    // Auditoría (E13): 3 hechos en el período y cadena íntegra.
    expect(c.auditoria.hechosEnPeriodo).toBe(3);
    expect(c.auditoria.totalHechos).toBe(3);
    expect(c.auditoria.cadenaIntegra).toBe(true);
  });

  it('bajo un alcance de agente, el libro consolidado no aplica y se refleja con causa (honesto)', async () => {
    const owner = await registerOwner(app, 'e12-agente');
    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date(Date.now() + 60 * 60 * 1000);

    const res = await owner.api
      .get(
        `/consolas/gerencial?agentId=agente-x&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
      )
      .expect(200);
    const c = res.body as Consola;
    expect(c.alcance.agentId).toBe('agente-x');
    expect(c.economia.consolidado).toBeNull();
    expect(c.economia.consolidadoCausa).toBe('ALCANCE_NO_CONSOLIDABLE');
  });

  it('aísla por workspace: otro workspace no ve los conteos ajenos', async () => {
    const owner = await registerOwner(app, 'e12-iso-a');
    await sembrarGobierno(owner.workspaceId);

    const otro = await registerOwner(app, 'e12-iso-b');
    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date(Date.now() + 60 * 60 * 1000);
    const c = await consola(otro, from, to);

    expect(c.gobierno.aprobacionesPendientes).toBe(0);
    expect(c.gobierno.suspensionesActivas).toBe(0);
    expect(c.gobierno.excepcionesAbiertas).toBe(0);
    expect(c.auditoria.hechosEnPeriodo).toBe(0);
    expect(c.auditoria.cadenaIntegra).toBe(true); // una cadena vacía está íntegra
  });

  it('rol: un VIEWER no accede a la consola gerencial (es vista de dirección, ADMIN+)', async () => {
    const owner = await registerOwner(app, 'e12-rol');
    const viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'e12-viewer' });
    const editor = await addMember(app, owner, { role: 'EDITOR', tag: 'e12-editor' });
    const admin = await addMember(app, owner, { role: 'ADMIN', tag: 'e12-admin' });

    await viewer.api.get('/consolas/gerencial').expect(403);
    await editor.api.get('/consolas/gerencial').expect(403);
    await admin.api.get('/consolas/gerencial').expect(200);
  });
});
