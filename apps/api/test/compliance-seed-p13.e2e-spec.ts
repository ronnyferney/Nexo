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
import { createTestApp, prismaOf } from './utils/app';
import { registerOwner, type Session } from './utils/fixtures';

/**
 * P1.3 · §6-bis + autorización 2026-11-03: siembra IDEMPOTENTE del catálogo de cumplimiento. Verifica contra PG real:
 *  - Cobranza CO (y transversales CO) quedan ACTIVAS (modo ASESOR, no bloqueante).
 *  - Salud, retail y transversales EC quedan INACTIVAS (preparadas, pendientes de validación/revisión jurídica).
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

  it('salud y retail quedan INACTIVAS (preparadas, pendientes de validación)', async () => {
    const salud = await prismaOf(app).reglaCumplimiento.findMany({
      where: { workspaceId: owner.workspaceId, sector: 'salud' },
    });
    const retail = await prismaOf(app).reglaCumplimiento.findMany({
      where: { workspaceId: owner.workspaceId, sector: 'retail' },
    });
    expect(salud).toHaveLength(REGLAS_SALUD.length);
    expect(retail).toHaveLength(REGLAS_RETAIL.length);
    expect(salud.every((r) => r.activa === false)).toBe(true);
    expect(retail.every((r) => r.activa === false)).toBe(true);
  });

  it('transversales EC quedan INACTIVAS (base de la próxima jurisdicción)', async () => {
    const reglas = await prismaOf(app).reglaCumplimiento.findMany({
      where: { workspaceId: owner.workspaceId, jurisdiccion: JURISDICCION_SIGUIENTE },
    });
    expect(reglas).toHaveLength(REGLAS_TRANSVERSALES_EC.length);
    expect(reglas.every((r) => r.activa === false)).toBe(true);
    expect(reglas.every((r) => r.jurisdiccion === 'EC')).toBe(true);
  });

  it('segunda ejecución: idempotente — no duplica y no cambia nada', async () => {
    const resumen = await seed.seedWorkspace(owner.workspaceId);
    expect(resumen).toMatchObject({ creadas: 0, actualizadas: 0, sinCambios: TOTAL });
    expect(await todasDelWorkspace(owner.workspaceId)).toHaveLength(TOTAL);
  });

  it('reconverge: restablece el `activa` y el contenido de una regla alterada', async () => {
    const [transversal] = await reglasTransversalesCO(owner.workspaceId);
    await prismaOf(app).reglaCumplimiento.update({
      where: { id: transversal.id },
      data: { activa: false, descripcion: 'desviada' },
    });
    const [salud] = await prismaOf(app).reglaCumplimiento.findMany({
      where: { workspaceId: owner.workspaceId, sector: 'salud' },
      take: 1,
    });
    await prismaOf(app).reglaCumplimiento.update({ where: { id: salud.id }, data: { activa: true } });

    const resumen = await seed.seedWorkspace(owner.workspaceId);
    expect(resumen).toMatchObject({ creadas: 0, actualizadas: 2, sinCambios: TOTAL - 2 });

    // La transversal vuelve a ACTIVA; la de salud vuelve a INACTIVA.
    const reconvergidaTransversal = await prismaOf(app).reglaCumplimiento.findUnique({ where: { id: transversal.id } });
    const reconvergidaSalud = await prismaOf(app).reglaCumplimiento.findUnique({ where: { id: salud.id } });
    expect(reconvergidaTransversal?.activa).toBe(true);
    expect(reconvergidaSalud?.activa).toBe(false);
  });

  it('aislamiento multi-tenant: sembrar un workspace no afecta a otro', async () => {
    expect(await todasDelWorkspace(otro.workspaceId)).toHaveLength(0);
  });
});
