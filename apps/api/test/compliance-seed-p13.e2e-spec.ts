import type { INestApplication } from '@nestjs/common';
import {
  ComplianceSeedService,
  DEFINICIONES_SEED,
  JURISDICCION_INICIAL,
  JURISDICCION_SIGUIENTE,
  REGLAS_COBRANZA_CO,
  REGLAS_RETAIL,
  REGLAS_SALUD,
  REGLAS_TRANSVERSALES_CO,
  REGLAS_TRANSVERSALES_EC,
} from '../src/modules/compliance/compliance-seed.service';
import {
  evaluarCumplimiento,
  resolverReglas,
  type ReglaCumplimientoPlana,
} from '../src/modules/compliance/cumplimiento.resolver';
import { createTestApp, prismaOf } from './utils/app';
import { registerOwner, type Session } from './utils/fixtures';

/**
 * P1.3 · §6-bis + autorización 2026-11-03: siembra IDEMPOTENTE del catálogo de cumplimiento. Verifica contra PG real:
 *  - Transversales CO, cobranza CO, salud CO y retail CO quedan ACTIVAS (modo ASESOR, no bloqueante).
 *  - Transversales EC quedan INACTIVAS (preparadas; activación productiva condicionada a revisión jurídica).
 *  - VALIDACIÓN de EC sin activarla en el seed: las definiciones EC resuelven correctamente para un contexto EC
 *    (motor puro), demostrando que están listas para pruebas sin tocar el seed productivo.
 *  - Idempotencia: correr dos veces no duplica; reconverge si una fila fue alterada.
 *  - Aislamiento multi-tenant: sembrar un workspace no afecta a otro.
 */
describe('Cumplimiento · seed catálogo inicial P1.3 (e2e)', () => {
  let app: INestApplication;
  let seed: ComplianceSeedService;
  let owner: Session;
  let otro: Session;

  const TOTAL = DEFINICIONES_SEED.length;
  const camposTransversalesCO = REGLAS_TRANSVERSALES_CO.map((r) => r.campoClave).sort();

  const reglasTransversalesCO = (workspaceId: string) =>
    prismaOf(app).reglaCumplimiento.findMany({
      where: { workspaceId, jurisdiccion: JURISDICCION_INICIAL, sector: null, proceso: null, nivelRiesgo: null },
      orderBy: { campoClave: 'asc' },
    });

  const todasDelWorkspace = (workspaceId: string) =>
    prismaOf(app).reglaCumplimiento.findMany({ where: { workspaceId }, orderBy: { campoClave: 'asc' } });

  beforeAll(async () => {
    app = await createTestApp();
    seed = app.get(ComplianceSeedService);
    owner = await registerOwner(app, 'seed-cmp-owner');
    otro = await registerOwner(app, 'seed-cmp-otro');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('primera ejecución: crea todo el catálogo (CO activo, salud/retail/EC inactivo)', async () => {
    const resumen = await seed.seedWorkspace(owner.workspaceId);
    expect(resumen).toMatchObject({ creadas: TOTAL, actualizadas: 0, sinCambios: 0 });

    const todas = await todasDelWorkspace(owner.workspaceId);
    expect(todas).toHaveLength(TOTAL);
    expect(todas.every((r) => typeof r.descripcion === 'string' && r.descripcion.length > 0)).toBe(true);
  });

  it('transversales CO quedan ACTIVAS y acotadas a CO', async () => {
    const reglas = await reglasTransversalesCO(owner.workspaceId);
    expect(reglas).toHaveLength(REGLAS_TRANSVERSALES_CO.length);
    expect(reglas.map((r) => r.campoClave).sort()).toEqual(camposTransversalesCO);
    expect(reglas.every((r) => r.activa === true)).toBe(true);
    expect(reglas.every((r) => r.jurisdiccion === 'CO')).toBe(true);
  });

  it('cobranza CO (sector financiero) queda ACTIVA en modo asesor', async () => {
    const reglas = await prismaOf(app).reglaCumplimiento.findMany({
      where: { workspaceId: owner.workspaceId, jurisdiccion: JURISDICCION_INICIAL, sector: 'financiero' },
    });
    expect(reglas).toHaveLength(REGLAS_COBRANZA_CO.length);
    expect(reglas.every((r) => r.activa === true)).toBe(true);
    // El campo de riesgo ALTO existe con su alcance específico.
    expect(reglas.some((r) => r.campoClave === 'revisionHumanaPrevia' && r.nivelRiesgo === 'ALTO')).toBe(true);
  });

  it('salud y retail quedan ACTIVAS (CO, modo asesor) y acotadas a su sector/jurisdicción', async () => {
    const salud = await prismaOf(app).reglaCumplimiento.findMany({
      where: { workspaceId: owner.workspaceId, sector: 'salud' },
    });
    const retail = await prismaOf(app).reglaCumplimiento.findMany({
      where: { workspaceId: owner.workspaceId, sector: 'retail' },
    });
    expect(salud).toHaveLength(REGLAS_SALUD.length);
    expect(retail).toHaveLength(REGLAS_RETAIL.length);
    expect(salud.every((r) => r.activa === true)).toBe(true);
    expect(retail.every((r) => r.activa === true)).toBe(true);
    // El alcance sectorial y la jurisdicción CO se preservan (no se vuelven comodín ni cambian de jurisdicción).
    expect(salud.every((r) => r.sector === 'salud' && r.jurisdiccion === JURISDICCION_INICIAL)).toBe(true);
    expect(retail.every((r) => r.sector === 'retail' && r.jurisdiccion === JURISDICCION_INICIAL)).toBe(true);
    // Campo de riesgo ALTO de salud conserva su alcance específico.
    expect(salud.some((r) => r.campoClave === 'evaluacionImpactoRealizada' && r.nivelRiesgo === 'ALTO')).toBe(true);
  });

  it('transversales EC quedan INACTIVAS (base de la próxima jurisdicción)', async () => {
    const reglas = await prismaOf(app).reglaCumplimiento.findMany({
      where: { workspaceId: owner.workspaceId, jurisdiccion: JURISDICCION_SIGUIENTE },
    });
    expect(reglas).toHaveLength(REGLAS_TRANSVERSALES_EC.length);
    expect(reglas.every((r) => r.activa === false)).toBe(true);
    expect(reglas.every((r) => r.jurisdiccion === 'EC')).toBe(true);
  });

  it('VALIDACIÓN de EC sin activarla: las definiciones EC resuelven y evalúan para un contexto jurisdiccion=EC', async () => {
    // Autorización 2026-11-03: EC se PREPARA y VALIDA en pruebas, pero NO se activa en el seed productivo. Aquí se
    // evalúa el MOTOR PURO con las definiciones EC marcadas activas SOLO en memoria (no se persiste ni se toca el seed).
    const ecActivasEnMemoria: ReglaCumplimientoPlana[] = REGLAS_TRANSVERSALES_EC.map((r) => ({
      jurisdiccion: r.jurisdiccion,
      sector: r.sector,
      proceso: r.proceso,
      nivelRiesgo: r.nivelRiesgo,
      campoClave: r.campoClave,
      tipoDato: r.tipoDato,
      reglaValidacion: r.reglaValidacion,
      controlProteccion: r.controlProteccion,
      descripcion: r.descripcion,
      activa: true,
    }));
    const camposEc = REGLAS_TRANSVERSALES_EC.map((r) => r.campoClave).sort();

    // Para un contexto EC, las reglas EC resuelven (todas aplican por jurisdicción).
    const resueltasEc = resolverReglas(ecActivasEnMemoria, { jurisdiccion: JURISDICCION_SIGUIENTE });
    expect(resueltasEc.map((r) => r.campoClave).sort()).toEqual(camposEc);

    // Para un contexto CO, las reglas EC NO aplican (aislamiento por jurisdicción).
    const resueltasCo = resolverReglas(ecActivasEnMemoria, { jurisdiccion: JURISDICCION_INICIAL });
    expect(resueltasCo).toHaveLength(0);

    // Evaluación asesora EC: sin valores informa faltantes; con valores válidos cumple (resuelve correctamente).
    const sinValores = evaluarCumplimiento(resueltasEc, {});
    expect(sinValores.modo).toBe('ASESOR');
    expect(sinValores.cumple).toBe(false);
    expect(sinValores.faltantes.map((f) => f.campoClave).sort()).toEqual(camposEc);

    const conValores = evaluarCumplimiento(resueltasEc, {
      clasificacionDatos: 'interno',
      jurisdiccionAplicable: 'EC',
      baseLegalTratamiento: 'consentimiento',
      supervisionHumanaRegistrada: true,
    });
    expect(conValores.cumple).toBe(true);

    // CRÍTICO: el seed productivo mantiene EC INACTIVA en BD (la validación anterior fue solo en memoria).
    const ecEnBd = await prismaOf(app).reglaCumplimiento.findMany({
      where: { workspaceId: owner.workspaceId, jurisdiccion: JURISDICCION_SIGUIENTE },
    });
    expect(ecEnBd.every((r) => r.activa === false)).toBe(true);
  });

  it('segunda ejecución: idempotente — no duplica y no cambia nada', async () => {
    const resumen = await seed.seedWorkspace(owner.workspaceId);
    expect(resumen).toMatchObject({ creadas: 0, actualizadas: 0, sinCambios: TOTAL });
    expect(await todasDelWorkspace(owner.workspaceId)).toHaveLength(TOTAL);
  });

  it('reconverge: restablece el `activa` y el contenido de reglas alteradas (incluida EC)', async () => {
    const [transversal] = await reglasTransversalesCO(owner.workspaceId);
    await prismaOf(app).reglaCumplimiento.update({
      where: { id: transversal.id },
      data: { activa: false, descripcion: 'desviada' },
    });
    // Salud nace ACTIVA: desviarla a INACTIVA y comprobar que reconverge a ACTIVA.
    const [salud] = await prismaOf(app).reglaCumplimiento.findMany({
      where: { workspaceId: owner.workspaceId, sector: 'salud' },
      take: 1,
    });
    await prismaOf(app).reglaCumplimiento.update({ where: { id: salud.id }, data: { activa: false } });
    // EC nace INACTIVA: desviarla a ACTIVA y comprobar que el seed la vuelve a dejar INACTIVA (no la activa).
    const [ec] = await prismaOf(app).reglaCumplimiento.findMany({
      where: { workspaceId: owner.workspaceId, jurisdiccion: JURISDICCION_SIGUIENTE },
      take: 1,
    });
    await prismaOf(app).reglaCumplimiento.update({ where: { id: ec.id }, data: { activa: true } });

    const resumen = await seed.seedWorkspace(owner.workspaceId);
    expect(resumen).toMatchObject({ creadas: 0, actualizadas: 3, sinCambios: TOTAL - 3 });

    // La transversal y la de salud vuelven a ACTIVAS; la de EC vuelve a INACTIVA.
    const reconvergidaTransversal = await prismaOf(app).reglaCumplimiento.findUnique({ where: { id: transversal.id } });
    const reconvergidaSalud = await prismaOf(app).reglaCumplimiento.findUnique({ where: { id: salud.id } });
    const reconvergidaEc = await prismaOf(app).reglaCumplimiento.findUnique({ where: { id: ec.id } });
    expect(reconvergidaTransversal?.activa).toBe(true);
    expect(reconvergidaSalud?.activa).toBe(true);
    expect(reconvergidaEc?.activa).toBe(false);
  });

  it('aislamiento multi-tenant: sembrar un workspace no afecta a otro', async () => {
    expect(await todasDelWorkspace(otro.workspaceId)).toHaveLength(0);
  });
});
