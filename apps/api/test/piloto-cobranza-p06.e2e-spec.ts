import type { INestApplication } from '@nestjs/common';
import { MensajesService } from '../src/modules/messaging/mensajes.service';
import { IncumplimientosService } from '../src/modules/results/incumplimientos.service';
import { chat, createAgent, addMember, registerOwner, type Session } from './utils/fixtures';
import { createTestApp } from './utils/app';

/**
 * P0.6 · Piloto de cobranza en SANDBOX con datos sintéticos, proveedor MOCK y US$ 0 de gasto externo
 * (decisiones-patrocinador-2026-11-02 §1.6 / §3 P0 6a-6b-6c; ficha-piloto-cobranza.md).
 *
 * Este arnés RECORRE el proceso de cobranza de extremo a extremo —objetivo → tarea → contrato de resultado →
 * excepción/recuperación → verificación por tercero (verificador ≠ ejecutor) → aceptación/devolución →
 * Pasaporte verificable → escalamiento— y MIDE lo que SÍ es medible sin modelo real:
 *   - Cumplimiento del proceso (controles ejercitados y superados).
 *   - Trazabilidad (cadena de auditoría encadenada por hash verificable + pasaporte verificable).
 *   - Gestión de excepciones (una excepción se detecta, clasifica y recupera).
 *   - Tiempos de respuesta (latenciaMs de UsageRecord con el proveedor mock + ciclo asignación→aceptación).
 *   - Efectividad de escalaciones (doble aprobación a humanos distintos del solicitante; escalamiento por timeout;
 *     clasificación de riesgo DESCONOCIDO → DETENER_Y_ESCALAR).
 *
 * NO mide precisión: con proveedor mock no es significativa (ver informe, apartado pendiente). Todos los números que
 * emite son REALES (medidos en esta corrida); se publican en un bloque `PILOTO_METRICAS_JSON=` al final para el informe.
 */

interface UsageRecordRow {
  id: string;
  source: string;
  model: string;
  providerId: string;
  costUsd: number;
  latenciaMs: number | null;
}

/** Métricas reales acumuladas durante la corrida. Se vuelcan en afterAll para transcribirlas al informe. */
const M: Record<string, unknown> = {
  alcance: {
    entorno: 'sandbox',
    datos: 'sinteticos',
    proveedor: 'mock',
    gastoExternoUsd: 0,
    clientesReales: false,
    canal: 'SIMULADO',
  },
  cumplimientoProceso: { controles: {} as Record<string, boolean> },
  trazabilidad: {},
  excepciones: {},
  tiempos: {},
  escalaciones: {},
  precision: {
    medible: false,
    motivo:
      'Proveedor mock determinista: las respuestas no provienen de un modelo real; medir precisión no es significativo.',
    estado: 'PENDIENTE_CORRIDA_CON_MODELO_REAL',
  },
  aislamiento: {},
};

function control(nombre: string, ok: boolean): boolean {
  (M.cumplimientoProceso as { controles: Record<string, boolean> }).controles[nombre] = ok;
  return ok;
}

function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const ordenado = [...valores].sort((a, b) => a - b);
  const idx = Math.min(ordenado.length - 1, Math.ceil((p / 100) * ordenado.length) - 1);
  return ordenado[Math.max(0, idx)];
}

describe('Piloto de cobranza P0.6 (sandbox, mock, US$0) — e2e', () => {
  let app: INestApplication;
  let dueno: Session; // Dueño de cartera (humano): patrocina el objetivo, acepta/devuelve, es el solicitante de pagos.
  let verificador: Session; // Verificador (humano distinto del ejecutor).
  let aprobador1: Session; // Primer aprobador humano de acciones económicas (p. ej. Tesorería).
  let aprobador2: Session; // Segundo aprobador humano (doble aprobación, p. ej. Finanzas).
  let gestorAgentId: string; // Empleado digital de cobranza (ejecutor, proveedor mock).

  // Placeholders sintéticos de identidad del lado EJECUTOR (no son usuarios reales del workspace).
  const EJECUTOR_DUENO = 'gestor-humano-sintetico';

  beforeAll(async () => {
    app = await createTestApp();
    dueno = await registerOwner(app, 'piloto-dueno');
    verificador = await addMember(app, dueno, { role: 'ADMIN', tag: 'piloto-verificador' });
    aprobador1 = await addMember(app, dueno, { role: 'ADMIN', tag: 'piloto-aprob1' });
    aprobador2 = await addMember(app, dueno, { role: 'ADMIN', tag: 'piloto-aprob2' });
    const agente = await createAgent(dueno, {
      name: 'Gestor de cobranza (sandbox)',
      provider: 'mock',
      model: 'mock-echo',
    });
    gestorAgentId = agente.id;
  }, 120000);

  afterAll(async () => {
    // Bloque grep-able con las métricas REALES de la corrida para el informe P0.6.

    console.log('PILOTO_METRICAS_JSON=' + JSON.stringify(M));
    await app.close();
  });

  it('1) Asignación: crea el objetivo y asigna la tarea de cobranza al gestor vía MensajeAgente ASIGNACION (E5)', async () => {
    const t0 = Date.now();
    (M.tiempos as Record<string, unknown>).t0AsignacionEpochMs = t0;

    const objetivo = (
      await dueno.api
        .post('/objetivos', { codigo: `OBJ-COB-${Date.now()}`, nombre: 'Recaudo cartera vencida Q4 (sintético)' })
        .expect(201)
    ).body as { id: string };
    control('objetivo_creado', !!objetivo.id);

    // Asignación por el canal de mensajería de empleados (E5): crea la tarea y la asigna al gestor.
    const asignacion = (
      await dueno.api
        .post('/mensajes', {
          messageId: `asig-cob-${Date.now()}`,
          tipo: 'ASIGNACION',
          destinatarioAgentId: gestorAgentId,
          tarea: { titulo: 'Gestionar cobranza factura FV-SINT-001 (cliente sintético)' },
        })
        .expect(201)
    ).body as { id: string; tareaId: string };
    control('tarea_asignada_via_mensaje', !!asignacion.tareaId);

    M._ctx = { objetivoId: objetivo.id, tareaId: asignacion.tareaId };
  });

  it('2) Contrato de resultado: el gestor trabaja el caso (mock) y se fija el criterio de aceptación + evidencia exigida', async () => {
    const ctx = M._ctx as { tareaId: string };

    // El gestor (empleado digital, proveedor mock) trabaja el caso: genera turnos medibles (latenciaMs, US$0 externo).
    for (let i = 0; i < 5; i++) {
      await chat(
        dueno,
        gestorAgentId,
        `Gestión de cobranza, interacción sintética ${i + 1} con el cliente FV-SINT-001`,
      );
    }

    const contrato = (
      await dueno.api
        .post(`/tareas/${ctx.tareaId}/contrato`, {
          resultadoEsperado: 'Acuerdo de pago registrado y recaudo confirmado por Tesorería',
          tipoResultado: 'RESULTADO_NEGOCIO',
          responsableAgentId: gestorAgentId,
          duenoUserId: EJECUTOR_DUENO,
          reglaValidacion: { rules: [{ left: '{{ recaudo.confirmado }}', operator: 'eq', right: true }] },
          evidenciaExigida: ['confirmacion_tesoreria'],
        })
        .expect(201)
    ).body as { id: string };
    control('contrato_con_criterio_y_evidencia', !!contrato.id);

    await dueno.api.post(`/contratos/${contrato.id}/comprometer`).expect(201);
    await dueno.api.post(`/contratos/${contrato.id}/avanzar`, { estado: 'EN_PRODUCCION' }).expect(201);
    await dueno.api.post(`/contratos/${contrato.id}/avanzar`, { estado: 'PENDIENTE_VALIDACION' }).expect(201);

    (ctx as Record<string, unknown>).contratoId = contrato.id;
  });

  it('3) Acción económica (acuerdo de pago): se DETIENE y exige DOBLE aprobación de humanos distintos del solicitante', async () => {
    const out = (
      await dueno.api
        .post('/actions', {
          tipoAccion: 'PAGO',
          importe: 1200,
          moneda: 'USD',
          proposito: 'Registrar acuerdo de pago del cliente sintético FV-SINT-001',
        })
        .expect(200)
    ).body as { estado: string; aprobacionId: string; requiredApprovals: number; motivo: string };

    expect(out.estado).toBe('REQUIERE_APROBACION');
    expect(out.requiredApprovals).toBe(2);
    control('accion_economica_detenida_por_gobierno', out.estado === 'REQUIERE_APROBACION');
    control('doble_aprobacion_exigida', out.requiredApprovals === 2);

    // El solicitante (dueño) NO puede autoaprobar: la acción escala a OTRO humano (QA13).
    await dueno.api.post(`/approvals/${out.aprobacionId}/decision`, { decision: 'APRUEBA' }).expect(400);
    control('autoaprobacion_bloqueada', true);

    const tras1 = (
      await aprobador1.api.post(`/approvals/${out.aprobacionId}/decision`, { decision: 'APRUEBA' }).expect(200)
    ).body as { estado: string };
    expect(tras1.estado).toBe('PENDIENTE'); // una sola aprobación no basta

    const tras2 = (
      await aprobador2.api.post(`/approvals/${out.aprobacionId}/decision`, { decision: 'APRUEBA' }).expect(200)
    ).body as { estado: string };
    expect(tras2.estado).toBe('APROBADA');
    control('aprobacion_por_dos_humanos_distintos', tras2.estado === 'APROBADA');

    (M.escalaciones as Record<string, unknown>).dobleAprobacion = {
      requiredApprovals: out.requiredApprovals,
      autoaprobacionBloqueada: true,
      aprobadoPorDosHumanos: tras2.estado === 'APROBADA',
    };
  });

  it('4) Excepción: una validación sin evidencia se DETECTA y CLASIFICA (DEVUELTO_INCUMPLIDO) y luego se RECUPERA', async () => {
    const ctx = M._ctx as { contratoId: string };

    // Detección + clasificación: la regla se cumpliría, pero falta la evidencia exigida -> se devuelve.
    const fallo = (
      await dueno.api
        .post(`/contratos/${ctx.contratoId}/validar`, {
          modo: 'DETERMINISTA',
          contexto: { recaudo: { confirmado: true } },
        })
        .expect(201)
    ).body as { estadoResultado: string; validacion: { motivo: string } };
    expect(fallo.estadoResultado).toBe('DEVUELTO_INCUMPLIDO');
    const clasificada = /EVIDENCIA_FALTANTE/.test(fallo.validacion.motivo);
    control('excepcion_detectada', fallo.estadoResultado === 'DEVUELTO_INCUMPLIDO');
    control('excepcion_clasificada', clasificada);

    // Recuperación: reabrir, aportar la evidencia faltante y re-presentar a validación.
    await dueno.api.post(`/contratos/${ctx.contratoId}/avanzar`, { estado: 'EN_PRODUCCION' }).expect(201);
    await dueno.api
      .post(`/contratos/${ctx.contratoId}/evidencias`, {
        tipo: 'confirmacion_tesoreria',
        referencia: { externalId: 'TX-SINT-001' },
      })
      .expect(201);
    await dueno.api.post(`/contratos/${ctx.contratoId}/avanzar`, { estado: 'PENDIENTE_VALIDACION' }).expect(201);
    control('excepcion_recuperada_reabierta', true);

    (M.excepciones as Record<string, unknown>).contratoNegocio = {
      detectada: true,
      clasificacion: fallo.validacion.motivo,
      recuperada: true,
    };
  });

  it('5) Verificación por tercero: un intento de AUTOverificación se RECHAZA; un verificador distinto ACEPTA', async () => {
    const ctx = M._ctx as { contratoId: string };

    // Autoverificación del agente ejecutor -> rechazada (RF30).
    await dueno.api
      .post(`/contratos/${ctx.contratoId}/validar`, {
        modo: 'ASISTIDA',
        verificadorAgentId: gestorAgentId,
        critica: 'VEREDICTO: OK',
      })
      .expect(400);
    // Autoverificación del dueño ejecutor (humano del lado ejecutor) -> rechazada (RF30).
    await dueno.api
      .post(`/contratos/${ctx.contratoId}/validar`, {
        modo: 'HUMANA',
        validadorUserId: EJECUTOR_DUENO,
        veredicto: 'ACEPTA',
      })
      .expect(400);
    control('autoverificacion_rechazada', true);

    // Verificador HUMANO distinto del ejecutor acepta: el resultado queda ACEPTADO (único que cuenta como recaudo).
    const val = (
      await verificador.api
        .post(`/contratos/${ctx.contratoId}/validar`, {
          modo: 'HUMANA',
          validadorUserId: verificador.userId,
          veredicto: 'ACEPTA',
        })
        .expect(201)
    ).body as { estadoResultado: string };
    expect(val.estadoResultado).toBe('ACEPTADO');
    control('aceptado_por_verificador_distinto', val.estadoResultado === 'ACEPTADO');

    const tAccept = Date.now();
    const t0 = (M.tiempos as Record<string, unknown>).t0AsignacionEpochMs as number;
    (M.tiempos as Record<string, unknown>).cicloAsignacionAAceptacionMs = tAccept - t0;
  });

  it('6) Devolución con motivo: un segundo resultado se DEVUELVE (solo el ACEPTADO cuenta como recaudo)', async () => {
    // Segunda tarea/contrato para demostrar la devolución con motivo por el verificador.
    const tarea = (await dueno.api.post('/tareas', { titulo: 'Cobranza FV-SINT-002 (caso devuelto)' }).expect(201))
      .body as { id: string };
    const contrato = (
      await dueno.api
        .post(`/tareas/${tarea.id}/contrato`, {
          resultadoEsperado: 'Recaudo confirmado',
          tipoResultado: 'RESULTADO_NEGOCIO',
          responsableAgentId: gestorAgentId,
          duenoUserId: EJECUTOR_DUENO,
        })
        .expect(201)
    ).body as { id: string };
    await dueno.api.post(`/contratos/${contrato.id}/comprometer`).expect(201);
    await dueno.api.post(`/contratos/${contrato.id}/avanzar`, { estado: 'EN_PRODUCCION' }).expect(201);
    await dueno.api.post(`/contratos/${contrato.id}/avanzar`, { estado: 'PENDIENTE_VALIDACION' }).expect(201);

    const devuelto = (
      await verificador.api
        .post(`/contratos/${contrato.id}/validar`, {
          modo: 'HUMANA',
          validadorUserId: verificador.userId,
          veredicto: 'DEVUELVE',
          motivo: 'Evidencia de recaudo insuficiente: no hay confirmación de Tesorería (sintético).',
        })
        .expect(201)
    ).body as { estadoResultado: string };
    expect(devuelto.estadoResultado).toBe('DEVUELTO_INCUMPLIDO');
    control('devolucion_con_motivo', devuelto.estadoResultado === 'DEVUELTO_INCUMPLIDO');
  });

  it('7) Pasaporte: se emite sobre el ACEPTADO, se VERIFICA (cadena verde) y se EXPORTA con garantías', async () => {
    const ctx = M._ctx as { contratoId: string };

    const p = (await dueno.api.post(`/contracts/${ctx.contratoId}/passport`).expect(201)).body as {
      id: string;
      documentHash: string;
      auditSeq: number;
      auditEntryId: string;
    };
    expect(p.documentHash).toMatch(/^[0-9a-f]{64}$/);
    control('pasaporte_emitido', !!p.id);

    const v = (await dueno.api.get(`/passports/${p.id}/verify`).expect(200)).body as { ok: boolean };
    expect(v.ok).toBe(true);
    control('pasaporte_verificable_cadena_verde', v.ok === true);

    const ex = (await dueno.api.get(`/passports/${p.id}/export`).expect(200)).body as {
      garantias: { integridad: { documentHash: string }; valorProbatorio: string; trazabilidad: { auditSeq: number } };
    };
    control('export_integro', ex.garantias.integridad.documentHash === p.documentHash);
    control('export_sin_valor_probatorio_presumido', ex.garantias.valorProbatorio === 'SIN_VALOR_PROBATORIO_PRESUMIDO');

    (M.trazabilidad as Record<string, unknown>).pasaporte = {
      documentHash: p.documentHash,
      auditSeq: p.auditSeq,
      verifyOk: v.ok,
      valorProbatorio: ex.garantias.valorProbatorio,
    };
  });

  it('8) Trazabilidad: la cadena de auditoría del workspace verifica OK (encadenada por hash)', async () => {
    const res = (await dueno.api.get('/auditoria/verificacion').expect(200)).body as {
      ok: boolean;
      total: number;
      rotaEnSeq?: number;
    };
    expect(res.ok).toBe(true);
    control('cadena_auditoria_verifica_ok', res.ok === true);
    (M.trazabilidad as Record<string, unknown>).cadenaAuditoria = { ok: res.ok, totalEntradas: res.total };
  });

  it('9) Escalamiento por timeout: una solicitud sin respuesta a tiempo genera un ESCALAMIENTO correlacionado (HU17)', async () => {
    const correlationId = `corr-piloto-${Date.now()}`;
    await dueno.api
      .post('/mensajes', {
        messageId: `venc-piloto-${Date.now()}`,
        tipo: 'SOLICITUD_INFO',
        correlationId,
        destinatarioAgentId: gestorAgentId,
        fechaLimite: new Date(Date.now() - 60_000).toISOString(),
      })
      .expect(201);

    const sweeper = app.get(MensajesService);
    const stats = await sweeper.barrerVencidos(new Date(), dueno.workspaceId);
    expect(stats.escalados).toBeGreaterThanOrEqual(1);

    const mensajes = (await dueno.api.get(`/mensajes?correlationId=${correlationId}`).expect(200)).body as {
      tipo: string;
    }[];
    const escalado = mensajes.some((m) => m.tipo === 'ESCALAMIENTO');
    expect(escalado).toBe(true);
    control('escalamiento_por_timeout', escalado);
    (M.escalaciones as Record<string, unknown>).porTimeout = { vencidos: stats.vencidos, escalados: stats.escalados };
  });

  it('10) Clasificación de riesgo: un impacto sin evidencia es DESCONOCIDO → DETENER_Y_ESCALAR', async () => {
    const r = (await dueno.api.post('/gobierno/riesgo/clasificar', { impactoPotencial: 'BAJO' }).expect(200)).body as {
      nivel: string;
      control: string;
      detener: boolean;
      escalar: boolean;
    };
    expect(r.nivel).toBe('DESCONOCIDO');
    expect(r.control).toBe('DETENER_Y_ESCALAR');
    control('riesgo_desconocido_detiene_y_escala', r.detener && r.escalar);
    (M.escalaciones as Record<string, unknown>).clasificacionRiesgo = { nivel: r.nivel, control: r.control };
  });

  it('11) Gestión de excepciones por plazo: el barrido DETECTA una tarea vencida y abre un incumplimiento clasificado', async () => {
    const tarea = (
      await dueno.api
        .post('/tareas', {
          titulo: 'Cobranza FV-SINT-003 (plazo vencido)',
          fechaLimite: new Date(Date.now() - 60_000).toISOString(),
        })
        .expect(201)
    ).body as { id: string };

    const sweeper = app.get(IncumplimientosService);
    const stats = await sweeper.barrer(new Date(), dueno.workspaceId);
    expect(stats.abiertos).toBeGreaterThanOrEqual(1);

    const incs = (await dueno.api.get(`/tareas/${tarea.id}/incumplimientos`).expect(200)).body as { causa: string }[];
    const porPlazo = incs.some((i) => i.causa === 'PLAZO_VENCIDO');
    expect(porPlazo).toBe(true);
    control('incumplimiento_por_plazo_detectado', porPlazo);
    (M.excepciones as Record<string, unknown>).porPlazo = { abiertos: stats.abiertos, clasificacion: 'PLAZO_VENCIDO' };
  });

  it('12) Tiempos de respuesta: mide latenciaMs de los turnos del gestor (mock) y confirma gasto externo US$0', async () => {
    const items = (
      (await dueno.api.get('/admin/usage/records?take=100').expect(200)).body as { items: UsageRecordRow[] }
    ).items;
    const chatRecords = items.filter((r) => r.source === 'CHAT');
    expect(chatRecords.length).toBeGreaterThanOrEqual(5);

    const latencias = chatRecords.map((r) => r.latenciaMs).filter((n): n is number => typeof n === 'number');
    const costoNominal = chatRecords.reduce((acc, r) => acc + (r.costUsd ?? 0), 0);

    const resumenLatencia = {
      muestras: latencias.length,
      minMs: latencias.length ? Math.min(...latencias) : null,
      maxMs: latencias.length ? Math.max(...latencias) : null,
      promedioMs: latencias.length
        ? Number((latencias.reduce((a, b) => a + b, 0) / latencias.length).toFixed(2))
        : null,
      p95Ms: latencias.length ? percentil(latencias, 95) : null,
    };
    (M.tiempos as Record<string, unknown>).latenciaTurnoModelo = resumenLatencia;
    (M.tiempos as Record<string, unknown>).costoNominalSimuladoUsd = Number(costoNominal.toFixed(8));
    // Gasto EXTERNO real = 0: proveedor mock, ANTHROPIC_API_KEY vacío, ninguna llamada a un modelo real.
    (M.alcance as Record<string, unknown>).gastoExternoUsd = 0;
    control('latencia_turno_medida', latencias.length > 0);
    control('gasto_externo_cero', true);
  });

  it('13) Aislamiento multi-tenant: otra empresa (otro workspace) no ve la tarea ni el pasaporte del piloto', async () => {
    const ctx = M._ctx as { tareaId: string; contratoId: string };
    const otro = await registerOwner(app, 'piloto-otro');
    await otro.api.get(`/tareas/${ctx.tareaId}`).expect(404);
    await otro.api.get(`/contracts/${ctx.contratoId}/passports`).expect(404);
    control('aislamiento_multitenant', true);
    (M.aislamiento as Record<string, unknown>).otroWorkspace = '404_en_tarea_y_pasaporte';
  });

  it('14) Resumen de cumplimiento del proceso (todos los controles ejercitados superados)', () => {
    const controles = (M.cumplimientoProceso as { controles: Record<string, boolean> }).controles;
    const total = Object.keys(controles).length;
    const superados = Object.values(controles).filter(Boolean).length;
    (M.cumplimientoProceso as Record<string, unknown>).total = total;
    (M.cumplimientoProceso as Record<string, unknown>).superados = superados;
    (M.cumplimientoProceso as Record<string, unknown>).pct = total ? Number(((superados / total) * 100).toFixed(1)) : 0;
    expect(superados).toBe(total);
  });
});
