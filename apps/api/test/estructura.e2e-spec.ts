import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/app';
import { addMember, createAgent, registerOwner, rootUnit, type Session } from './utils/fixtures';

/**
 * Estructura empresarial (ADR 0011 · E1). Verifica el CRUD de las entidades nuevas con aislamiento por workspace y por
 * empresa, que un VIEWER no muta, la regla de identidad RF42 (una sola FUNCIONAL_PRINCIPAL vigente por sujeto) y que
 * las unidades `OrgUnit` ya existentes siguen válidas con los valores por defecto (retrocompatibilidad).
 */
describe('Estructura empresarial (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  /** Crea un OrgUnit `EMPRESA` colgando de la raíz (requiere ADMIN+). */
  async function createEmpresa(s: Session, name: string, rootId: string): Promise<string> {
    const res = await s.api.post('/admin/org/units', { name, parentId: rootId, tipo: 'EMPRESA' }).expect(201);
    return (res.body as { id: string }).id;
  }

  describe('Retrocompatibilidad de OrgUnit', () => {
    it('la unidad raíz existente queda tipo=AREA_FUNCIONAL, estado=ACTIVA, empresaId=null', async () => {
      const owner = await registerOwner(app, 'retro');
      const root = await rootUnit(owner);
      expect(root).toMatchObject({ tipo: 'AREA_FUNCIONAL', estado: 'ACTIVA', empresaId: null });
    });

    it('acepta los nuevos campos de OrgUnit y valida empresaId', async () => {
      const owner = await registerOwner(app, 'orgext');
      const rootId = (await rootUnit(owner)).id;
      const empresaId = await createEmpresa(owner, 'ACME', rootId);
      // Un área que pertenece a la empresa.
      const area = await owner.api
        .post('/admin/org/units', { name: 'Comercial', parentId: empresaId, tipo: 'AREA_FUNCIONAL', empresaId })
        .expect(201);
      expect(area.body).toMatchObject({ tipo: 'AREA_FUNCIONAL', empresaId });
      // empresaId inexistente o que no es EMPRESA -> 400.
      await owner.api
        .post('/admin/org/units', { name: 'Mala', parentId: rootId, empresaId: 'no-existe' })
        .expect(400);
      await owner.api.post('/admin/org/units', { name: 'Mala2', parentId: rootId, empresaId: rootId }).expect(400);
    });
  });

  describe('CRUD de líneas, sedes y centros de costo + aislamiento', () => {
    let owner: Session;
    let viewer: Session;
    let empresaA: string;
    let empresaB: string;

    beforeAll(async () => {
      owner = await registerOwner(app, 'crud');
      viewer = await addMember(app, owner, { role: 'VIEWER' });
      const rootId = (await rootUnit(owner)).id;
      empresaA = await createEmpresa(owner, 'Empresa A', rootId);
      empresaB = await createEmpresa(owner, 'Empresa B', rootId);
    });

    it('crea, lee, edita y borra una línea de negocio; el código es único por empresa', async () => {
      const linea = await owner.api
        .post('/estructura/lineas-negocio', { empresaId: empresaA, codigo: 'LN1', nombre: 'Seguros', metas: { x: 1 } })
        .expect(201);
      const id = (linea.body as { id: string }).id;
      expect(linea.body).toMatchObject({ empresaId: empresaA, codigo: 'LN1', estado: 'ACTIVA' });

      await owner.api.get(`/estructura/lineas-negocio/${id}`).expect(200);
      await owner.api.patch(`/estructura/lineas-negocio/${id}`, { nombre: 'Seguros Generales' }).expect(200);

      // Código duplicado en la misma empresa -> 400; pero sí se permite el mismo código en otra empresa.
      await owner.api.post('/estructura/lineas-negocio', { empresaId: empresaA, codigo: 'LN1', nombre: 'Dup' }).expect(400);
      await owner.api
        .post('/estructura/lineas-negocio', { empresaId: empresaB, codigo: 'LN1', nombre: 'Otra' })
        .expect(201);

      // empresaId que no existe -> 400.
      await owner.api.post('/estructura/lineas-negocio', { empresaId: 'nope', codigo: 'LNX', nombre: 'X' }).expect(400);

      await owner.api.delete(`/estructura/lineas-negocio/${id}`).expect(204);
      await owner.api.get(`/estructura/lineas-negocio/${id}`).expect(404);
    });

    it('el filtro por empresa aísla los resultados (D1)', async () => {
      await owner.api.post('/estructura/sedes', { empresaId: empresaA, codigo: 'S-A', nombre: 'Bogotá', zonaHoraria: 'America/Bogota' }).expect(201);
      await owner.api.post('/estructura/sedes', { empresaId: empresaB, codigo: 'S-B', nombre: 'Madrid', zonaHoraria: 'Europe/Madrid' }).expect(201);

      const soloA = (await owner.api.get(`/estructura/sedes?empresaId=${empresaA}`).expect(200)).body as { empresaId: string }[];
      expect(soloA.length).toBeGreaterThan(0);
      expect(soloA.every((s) => s.empresaId === empresaA)).toBe(true);
      expect(soloA.some((s) => s.empresaId === empresaB)).toBe(false);
    });

    it('crea un centro de costo (dimensión de reporte, no unidad de reserva)', async () => {
      const cc = await owner.api
        .post('/estructura/centros-costo', { empresaId: empresaA, codigo: 'CC1', nombre: 'TI' })
        .expect(201);
      expect(cc.body).toMatchObject({ empresaId: empresaA, codigo: 'CC1' });
    });

    it('un VIEWER lee pero no muta', async () => {
      await viewer.api.get('/estructura/lineas-negocio').expect(200);
      await viewer.api.get('/estructura/sedes').expect(200);
      await viewer.api.get('/estructura/centros-costo').expect(200);
      await viewer.api.post('/estructura/lineas-negocio', { empresaId: empresaA, codigo: 'V1', nombre: 'No' }).expect(403);
      await viewer.api.post('/estructura/sedes', { empresaId: empresaA, codigo: 'V2', nombre: 'No', zonaHoraria: 'America/Bogota' }).expect(403);
      await viewer.api.post('/estructura/centros-costo', { empresaId: empresaA, codigo: 'V3', nombre: 'No' }).expect(403);
    });

    it('otro workspace no ve ni accede a los recursos (aislamiento multi-tenant y por empresa)', async () => {
      const otro = await registerOwner(app, 'ajeno');
      const linea = await owner.api
        .post('/estructura/lineas-negocio', { empresaId: empresaA, codigo: 'LN-ISO', nombre: 'Privada' })
        .expect(201);
      const id = (linea.body as { id: string }).id;
      // El otro workspace no la encuentra ni por id ni en su listado.
      await otro.api.get(`/estructura/lineas-negocio/${id}`).expect(404);
      const suyas = (await otro.api.get('/estructura/lineas-negocio').expect(200)).body as unknown[];
      expect(suyas).toHaveLength(0);
      // Y no puede crear recursos apuntando a la empresa del otro (su empresaId no existe en su workspace).
      await otro.api.post('/estructura/lineas-negocio', { empresaId: empresaA, codigo: 'ROB', nombre: 'Robo' }).expect(400);
    });
  });

  describe('Asignaciones y regla de identidad RF42', () => {
    let owner: Session;
    let rootId: string;
    let agentId: string;

    beforeAll(async () => {
      owner = await registerOwner(app, 'asig');
      rootId = (await rootUnit(owner)).id;
      agentId = (await createAgent(owner)).id;
    });

    it('exige exactamente un sujeto y el destino acorde al tipo', async () => {
      await owner.api.post('/estructura/asignaciones', { tipoAsignacion: 'FUNCIONAL_PRINCIPAL', orgUnitId: rootId }).expect(400);
      await owner.api
        .post('/estructura/asignaciones', { agentId, userId: owner.userId, tipoAsignacion: 'FUNCIONAL_PRINCIPAL', orgUnitId: rootId })
        .expect(400);
      // Tipo LINEA sin lineaNegocioId -> 400.
      await owner.api.post('/estructura/asignaciones', { agentId, tipoAsignacion: 'LINEA' }).expect(400);
      // Destino inexistente -> 400.
      await owner.api
        .post('/estructura/asignaciones', { agentId, tipoAsignacion: 'FUNCIONAL_PRINCIPAL', orgUnitId: 'no-existe' })
        .expect(400);
    });

    it('a lo sumo una FUNCIONAL_PRINCIPAL vigente por sujeto; cerrar la anterior libera el cupo', async () => {
      const primera = await owner.api
        .post('/estructura/asignaciones', { agentId, tipoAsignacion: 'FUNCIONAL_PRINCIPAL', orgUnitId: rootId })
        .expect(201);
      const primeraId = (primera.body as { id: string }).id;

      // La segunda vigente para el mismo agente falla (índice parcial único).
      await owner.api
        .post('/estructura/asignaciones', { agentId, tipoAsignacion: 'FUNCIONAL_PRINCIPAL', orgUnitId: rootId })
        .expect(409);

      // Cerrar la primera (poner vigenteHasta) no la borra, pero libera el cupo.
      await owner.api
        .patch(`/estructura/asignaciones/${primeraId}`, { vigenteHasta: new Date().toISOString(), estado: 'CERRADA' })
        .expect(200);
      const segunda = await owner.api
        .post('/estructura/asignaciones', { agentId, tipoAsignacion: 'FUNCIONAL_PRINCIPAL', orgUnitId: rootId })
        .expect(201);
      expect((segunda.body as { id: string }).id).not.toBe(primeraId);

      // La primera sigue existiendo (historial preservado, QA16).
      await owner.api.get(`/estructura/asignaciones/${primeraId}`).expect(200);
    });

    it('un agente atiende varias líneas con asignaciones transversales, sin duplicarse (RF42)', async () => {
      const empresa = await createEmpresa(owner, 'Multi', rootId);
      const l1 = (await owner.api.post('/estructura/lineas-negocio', { empresaId: empresa, codigo: 'M1', nombre: 'L1' }).expect(201)).body as { id: string };
      const l2 = (await owner.api.post('/estructura/lineas-negocio', { empresaId: empresa, codigo: 'M2', nombre: 'L2' }).expect(201)).body as { id: string };
      await owner.api.post('/estructura/asignaciones', { agentId, tipoAsignacion: 'LINEA', lineaNegocioId: l1.id }).expect(201);
      await owner.api.post('/estructura/asignaciones', { agentId, tipoAsignacion: 'LINEA', lineaNegocioId: l2.id }).expect(201);
      const delAgente = (await owner.api.get(`/estructura/asignaciones?agentId=${agentId}`).expect(200)).body as unknown[];
      // Varias filas de asignación para un mismo agente (no se clona el agente).
      expect(delAgente.length).toBeGreaterThanOrEqual(2);
    });
  });
});
