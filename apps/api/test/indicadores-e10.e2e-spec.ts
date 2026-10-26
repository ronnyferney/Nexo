import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/app';
import { registerOwner, type Session } from './utils/fixtures';

/**
 * E10 · Indicadores de resultado (RF27/RF28/RF30-métricas, sección 9). Verifica las fórmulas sobre datos reales:
 * cumplimiento (aceptada dentro del plazo), calidad (sin corrección), tiempo de ciclo (mediana/p95), costo por
 * resultado (solo aceptados; null sin costo), excepciones (null sin ejecuciones), y los KPIs sin fuente (horas
 * liberadas / beneficio validado → null con causa). Comprueba también el aislamiento por workspace.
 */
describe('Indicadores de resultado E10 (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  interface Kpis {
    cumplimiento: { numerador: number; denominador: number; pct: number | null; vencimientosEnPeriodo: number };
    calidad: { numerador: number; denominador: number; pct: number | null; revisadosEnPeriodo: number };
    tiempoCiclo: { muestras: number; medianaMs: number; p95Ms: number } | null;
    costoPorResultado: { resultadosAceptados: number; costoPorResultadoUsd: number | null; costoTotalUsd: number };
    excepciones: { numerador: number; ejecucionesIniciadas: number; pct: number | null };
    horasLiberadas: { estimacion: boolean; horas: number | null; causa: string };
    beneficioValidado: { validadoUsd: number | null; causa: string };
  }

  async function indicadores(s: Session, from: Date, to: Date): Promise<Kpis> {
    const qs = `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
    const res = await s.api.get(`/indicadores/resultados?${qs}`).expect(200);
    return (res.body as { kpis: Kpis }).kpis;
  }

  /** Crea objetivo + tarea de negocio + contrato determinista y lo deja en PENDIENTE_VALIDACION con la evidencia dada. */
  async function tareaEnValidacion(
    s: Session,
    opts: { fechaLimite?: Date; conEvidencia?: boolean } = {},
  ): Promise<{ tareaId: string; contratoId: string }> {
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
          ...(opts.fechaLimite ? { fechaLimite: opts.fechaLimite.toISOString() } : {}),
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
    if (opts.conEvidencia !== false) {
      await s.api
        .post(`/contratos/${contrato.id}/evidencias`, { tipo: 'factura', referencia: { externalId: 'TX-1' } })
        .expect(201);
    }
    return { tareaId: tarea.id, contratoId: contrato.id };
  }

  async function aceptar(s: Session, contratoId: string): Promise<void> {
    const val = (
      await s.api.post(`/contratos/${contratoId}/validar`, { modo: 'DETERMINISTA', contexto: { ok: true } }).expect(201)
    ).body as { estadoResultado: string };
    expect(val.estadoResultado).toBe('ACEPTADO');
  }

  it('cumplimiento, calidad, ciclo, costo (null sin costo) y KPIs sin fuente sobre un resultado aceptado a tiempo', async () => {
    const owner = await registerOwner(app, 'e10-ok');
    const from = new Date(Date.now() - 60 * 60 * 1000); // -1h
    const to = new Date(Date.now() + 2 * 60 * 60 * 1000); // +2h
    const fechaLimite = new Date(Date.now() + 60 * 60 * 1000); // +1h (aceptación ahora < plazo)

    const { contratoId } = await tareaEnValidacion(owner, { fechaLimite });
    await aceptar(owner, contratoId);

    const k = await indicadores(owner, from, to);

    // Cumplimiento: 1 vencimiento en el período, aceptado a tiempo.
    expect(k.cumplimiento.denominador).toBe(1);
    expect(k.cumplimiento.numerador).toBe(1);
    expect(k.cumplimiento.pct).toBe(100);

    // Calidad: 1 revisado, aceptado sin corrección.
    expect(k.calidad.denominador).toBe(1);
    expect(k.calidad.numerador).toBe(1);
    expect(k.calidad.pct).toBe(100);

    // Tiempo de ciclo: una muestra.
    expect(k.tiempoCiclo).not.toBeNull();
    expect(k.tiempoCiclo!.muestras).toBe(1);
    expect(k.tiempoCiclo!.medianaMs).toBeGreaterThanOrEqual(0);

    // Costo por resultado: 1 aceptado y sin UsageRecord → costo total 0 y costo/resultado 0 (hay base: 1 aceptado).
    expect(k.costoPorResultado.resultadosAceptados).toBe(1);
    expect(k.costoPorResultado.costoTotalUsd).toBe(0);
    expect(k.costoPorResultado.costoPorResultadoUsd).toBe(0);

    // Excepciones: sin ejecuciones iniciadas → ratio null (no divide por cero).
    expect(k.excepciones.ejecucionesIniciadas).toBe(0);
    expect(k.excepciones.pct).toBeNull();

    // KPIs sin fuente: marcados como null con causa.
    expect(k.horasLiberadas.estimacion).toBe(true);
    expect(k.horasLiberadas.horas).toBeNull();
    expect(k.horasLiberadas.causa).toBe('SIN_TIEMPO_REFERENCIA');
    expect(k.beneficioValidado.validadoUsd).toBeNull();
    expect(k.beneficioValidado.causa).toBe('SIN_FUENTE_BENEFICIO');
  });

  it('cumplimiento cuenta fuera de plazo cuando la aceptación es posterior a la fecha límite', async () => {
    const owner = await registerOwner(app, 'e10-tarde');
    const from = new Date(Date.now() - 2 * 60 * 60 * 1000); // -2h
    const to = new Date(Date.now() + 60 * 1000); // +1min
    const fechaLimite = new Date(Date.now() - 60 * 60 * 1000); // -1h (ya vencida: aceptar ahora es tarde)

    const { contratoId } = await tareaEnValidacion(owner, { fechaLimite });
    await aceptar(owner, contratoId);

    const k = await indicadores(owner, from, to);
    expect(k.cumplimiento.denominador).toBe(1);
    expect(k.cumplimiento.numerador).toBe(0); // aceptada, pero fuera de plazo
    expect(k.cumplimiento.pct).toBe(0);
  });

  it('calidad: un resultado devuelto y luego aceptado NO cuenta como aceptado sin corrección', async () => {
    const owner = await registerOwner(app, 'e10-devuelto');
    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date(Date.now() + 60 * 60 * 1000);

    // Sin evidencia: la verificación determinista devuelve el resultado.
    const { contratoId } = await tareaEnValidacion(owner, { conEvidencia: false });
    const dev = (
      await owner.api
        .post(`/contratos/${contratoId}/validar`, { modo: 'DETERMINISTA', contexto: { ok: true } })
        .expect(201)
    ).body as { estadoResultado: string };
    expect(dev.estadoResultado).toBe('DEVUELTO_INCUMPLIDO');

    // Reabrir, aportar la evidencia y aceptar: queda ACEPTADO pero con una corrección previa.
    await owner.api.post(`/contratos/${contratoId}/avanzar`, { estado: 'EN_PRODUCCION' }).expect(201);
    await owner.api
      .post(`/contratos/${contratoId}/evidencias`, { tipo: 'factura', referencia: { externalId: 'TX-2' } })
      .expect(201);
    await owner.api.post(`/contratos/${contratoId}/avanzar`, { estado: 'PENDIENTE_VALIDACION' }).expect(201);
    await aceptar(owner, contratoId);

    const k = await indicadores(owner, from, to);
    expect(k.calidad.revisadosEnPeriodo).toBe(1);
    expect(k.calidad.numerador).toBe(0); // fue devuelto: no es "sin corrección"
    expect(k.calidad.pct).toBe(0);
    // Pero sí es un resultado aceptado para el ciclo/costo.
    expect(k.costoPorResultado.resultadosAceptados).toBe(1);
  });

  it('aísla por workspace: otro workspace no ve los resultados del primero', async () => {
    const owner = await registerOwner(app, 'e10-iso-a');
    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const { contratoId } = await tareaEnValidacion(owner, { fechaLimite: new Date(Date.now() + 60 * 60 * 1000) });
    await aceptar(owner, contratoId);

    const otro = await registerOwner(app, 'e10-iso-b');
    const k = await indicadores(otro, from, to);
    expect(k.cumplimiento.denominador).toBe(0);
    expect(k.cumplimiento.pct).toBeNull();
    expect(k.calidad.denominador).toBe(0);
    expect(k.tiempoCiclo).toBeNull();
    expect(k.costoPorResultado.resultadosAceptados).toBe(0);
    expect(k.costoPorResultado.costoPorResultadoUsd).toBeNull();
  });
});
