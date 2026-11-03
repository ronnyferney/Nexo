import type { INestApplication } from '@nestjs/common';
import {
  ComplianceSeedService,
  JURISDICCION_INICIAL,
  REGLAS_TRANSVERSALES_CO,
} from '../src/modules/compliance/compliance-seed.service';
import { createTestApp, prismaOf } from './utils/app';
import { registerOwner, type Session } from './utils/fixtures';

/**
 * P1.3 · §6-bis: siembra IDEMPOTENTE de la configuración inicial aprobada (4 reglas transversales, jurisdiccion='CO',
 * resto del alcance comodín, `activa=true`, modo ASESOR). Se verifica contra PG real: correr el seed dos veces no
 * duplica y deja exactamente las 4 reglas activas y acotadas a CO; otro workspace no se ve afectado.
 */
describe('Cumplimiento · seed configuración inicial CO P1.3 (e2e)', () => {
  let app: INestApplication;
  let seed: ComplianceSeedService;
  let owner: Session;
  let otro: Session;

  const camposEsperados = REGLAS_TRANSVERSALES_CO.map((r) => r.campoClave).sort();

  const reglasCO = (workspaceId: string) =>
    prismaOf(app).reglaCumplimiento.findMany({
      where: { workspaceId, jurisdiccion: JURISDICCION_INICIAL, sector: null, proceso: null, nivelRiesgo: null },
      orderBy: { campoClave: 'asc' },
    });

  beforeAll(async () => {
    app = await createTestApp();
    seed = app.get(ComplianceSeedService);
    owner = await registerOwner(app, 'seed-cmp-owner');
    otro = await registerOwner(app, 'seed-cmp-otro');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('primera ejecución: crea las 4 reglas transversales activas y acotadas a CO', async () => {
    const resumen = await seed.seedWorkspace(owner.workspaceId);
    expect(resumen).toMatchObject({ creadas: 4, actualizadas: 0, sinCambios: 0 });

    const reglas = await reglasCO(owner.workspaceId);
    expect(reglas).toHaveLength(4);
    expect(reglas.map((r) => r.campoClave).sort()).toEqual(camposEsperados);
    expect(reglas.every((r) => r.activa === true)).toBe(true);
    expect(reglas.every((r) => r.jurisdiccion === 'CO')).toBe(true);
    expect(reglas.every((r) => r.sector === null && r.proceso === null && r.nivelRiesgo === null)).toBe(true);
    expect(reglas.every((r) => typeof r.descripcion === 'string' && r.descripcion.length > 0)).toBe(true);
  });

  it('segunda ejecución: idempotente — no duplica y no cambia nada', async () => {
    const resumen = await seed.seedWorkspace(owner.workspaceId);
    expect(resumen).toMatchObject({ creadas: 0, actualizadas: 0, sinCambios: 4 });

    const reglas = await reglasCO(owner.workspaceId);
    expect(reglas).toHaveLength(4);
    expect(reglas.every((r) => r.activa === true)).toBe(true);
  });

  it('reconverge: si una regla fue alterada, el seed la vuelve a dejar activa y correcta', async () => {
    const [primera] = await reglasCO(owner.workspaceId);
    await prismaOf(app).reglaCumplimiento.update({
      where: { id: primera.id },
      data: { activa: false, descripcion: 'desviada' },
    });

    const resumen = await seed.seedWorkspace(owner.workspaceId);
    expect(resumen).toMatchObject({ creadas: 0, actualizadas: 1, sinCambios: 3 });

    const reglas = await reglasCO(owner.workspaceId);
    expect(reglas).toHaveLength(4);
    expect(reglas.every((r) => r.activa === true)).toBe(true);
  });

  it('aislamiento multi-tenant: sembrar un workspace no afecta a otro', async () => {
    expect(await reglasCO(otro.workspaceId)).toHaveLength(0);
  });
});
