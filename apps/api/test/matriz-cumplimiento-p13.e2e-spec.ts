import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

/**
 * P1.3 (matriz de cumplimiento configurable y MULTISECTORIAL · ADR 0020): CRUD gobernado de reglas (solo ADMIN+,
 * auditado), resolución por contexto (la más específica SUMA; comodín aplica) y validación ASESORA (no bloqueante) de
 * un resultado/pasaporte. Garantías probadas: las reglas nacen INACTIVAS y no exigen nada hasta activarse; aislamiento
 * multi-tenant; rol. No afirma conformidad con ninguna norma.
 */
describe('Cumplimiento · matriz configurable P1.3 (e2e)', () => {
  let app: INestApplication;
  let owner: Session;
  let admin: Session;
  let viewer: Session;
  let otro: Session;

  const rules = (s: Session) => s.api.get('/admin/compliance/rules');
  const createRule = (s: Session, body: Record<string, unknown>) => s.api.post('/admin/compliance/rules', body);
  const resolve = (s: Session, qs: string) => s.api.get(`/compliance/resolve${qs}`);
  const validate = (s: Session, body: Record<string, unknown>) => s.api.post('/compliance/validate', body);

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'cmp-owner');
    admin = await addMember(app, owner, { role: 'ADMIN', tag: 'cmp-admin' });
    viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'cmp-viewer' });
    otro = await registerOwner(app, 'cmp-otro');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('Inicio seguro: reglas INACTIVAS no exigen nada (asesor, no bloqueante)', () => {
    it('sin reglas: la validación cumple y no exige nada', async () => {
      const r = (await validate(owner, { contexto: { sector: 'financiero' }, valores: {} }).expect(200)).body as {
        modo: string;
        cumple: boolean;
        totalReglas: number;
        faltantes: unknown[];
      };
      expect(r).toMatchObject({ modo: 'ASESOR', cumple: true, totalReglas: 0, faltantes: [] });
    });

    it('una regla creada INACTIVA no se aplica en la resolución ni en la validación', async () => {
      await createRule(owner, {
        sector: 'financiero',
        proceso: 'cobranza',
        campoClave: 'baseLegalTratamiento',
        tipoDato: 'TEXTO',
        controlProteccion: 'base-legal',
      }).expect(201);

      // Resolución por defecto (solo activas): vacía.
      expect((await resolve(owner, '?sector=financiero&proceso=cobranza').expect(200)).body).toEqual([]);
      // Validación asesora: no exige nada aún (no hay bloqueo productivo).
      const v = (await validate(owner, { contexto: { sector: 'financiero', proceso: 'cobranza' }, valores: {} }).expect(200))
        .body as { cumple: boolean; faltantes: unknown[] };
      expect(v).toMatchObject({ cumple: true, faltantes: [] });
    });
  });

  describe('Resolución por contexto: la más específica SUMA; comodín aplica', () => {
    it('al activar reglas de distintos alcances, el conjunto resuelto las SUMA por campo', async () => {
      // Comodín total (multisectorial).
      await createRule(owner, { campoClave: 'clasificacionDatos', tipoDato: 'TEXTO', activa: true }).expect(201);
      // Por sector (salud).
      await createRule(owner, {
        sector: 'salud',
        campoClave: 'consentimientoDatosPersonales',
        tipoDato: 'BOOLEANO',
        controlProteccion: 'consentimiento',
        activa: true,
      }).expect(201);

      const resuelto = (await resolve(owner, '?sector=salud').expect(200)).body as { campoClave: string }[];
      expect(resuelto.map((x) => x.campoClave).sort()).toEqual(['clasificacionDatos', 'consentimientoDatosPersonales']);

      // Otro sector (retail): solo aplica el comodín.
      const retail = (await resolve(owner, '?sector=retail').expect(200)).body as { campoClave: string }[];
      expect(retail.map((x) => x.campoClave)).toEqual(['clasificacionDatos']);
    });

    it('validación asesora con una regla activa: devuelve faltantes sin bloquear', async () => {
      const v = (await validate(owner, { contexto: { sector: 'salud' }, valores: { clasificacionDatos: 'interno' } }).expect(
        200,
      )).body as { cumple: boolean; faltantes: { campoClave: string; controlProteccion: string | null }[] };
      expect(v.cumple).toBe(false);
      expect(v.faltantes.map((f) => f.campoClave)).toEqual(['consentimientoDatosPersonales']);
      // Presente y válido ⇒ cumple.
      const ok = (await validate(owner, {
        contexto: { sector: 'salud' },
        valores: { clasificacionDatos: 'interno', consentimientoDatosPersonales: true },
      }).expect(200)).body as { cumple: boolean };
      expect(ok.cumple).toBe(true);
    });

    it('vista previa de configuración: incluirInactivas=true muestra también las inactivas', async () => {
      const r = (await resolve(owner, '?sector=financiero&proceso=cobranza&incluirInactivas=true').expect(200))
        .body as { campoClave: string }[];
      expect(r.some((x) => x.campoClave === 'baseLegalTratamiento')).toBe(true);
    });
  });

  describe('CRUD gobernado, auditoría y rol', () => {
    it('actualizar activa queda auditado (anterior/nuevo)', async () => {
      const creada = (await createRule(owner, {
        jurisdiccion: 'EC',
        campoClave: 'identificadorFiscal',
        tipoDato: 'TEXTO',
      }).expect(201)).body as { id: string; activa: boolean };
      expect(creada.activa).toBe(false);

      await owner.api.patch(`/admin/compliance/rules/${creada.id}`, { activa: true }).expect(200);
      const audit = (
        await owner.api
          .get('/auditoria?action=REGLA_CUMPLIMIENTO_MODIFICADA&targetType=ReglaCumplimiento&take=50')
          .expect(200)
      ).body as { items: { metadata: { nuevo: { activa: boolean } } }[] };
      expect(audit.items.some((e) => e.metadata?.nuevo?.activa === true)).toBe(true);
    });

    it('solo ADMIN/OWNER: VIEWER recibe 403 al listar o crear reglas', async () => {
      await rules(viewer).expect(403);
      await createRule(viewer, { campoClave: 'x', tipoDato: 'TEXTO' }).expect(403);
    });

    it('VIEWER sí puede resolver/validar (lectura asesora)', async () => {
      await resolve(viewer, '?sector=salud').expect(200);
      await validate(viewer, { contexto: { sector: 'salud' }, valores: {} }).expect(200);
    });

    it('valida alcance, tipo y campo obligatorio (class-validator)', async () => {
      await createRule(owner, { campoClave: 'y' }).expect(400); // falta tipoDato
      await createRule(owner, { tipoDato: 'TEXTO' }).expect(400); // falta campoClave
      await createRule(owner, { campoClave: 'y', tipoDato: 'OTRO' }).expect(400); // tipoDato inválido
      await createRule(owner, { campoClave: 'y', tipoDato: 'TEXTO', nivelRiesgo: 'EXTREMO' }).expect(400); // riesgo inválido
    });

    it('aislamiento multi-tenant: otro workspace no ve reglas ajenas y su matriz está vacía', async () => {
      expect((await rules(otro).expect(200)).body).toEqual([]);
      expect((await resolve(otro, '?sector=salud').expect(200)).body).toEqual([]);
      const v = (await validate(otro, { contexto: { sector: 'salud' }, valores: {} }).expect(200)).body as {
        cumple: boolean;
        totalReglas: number;
      };
      expect(v).toMatchObject({ cumple: true, totalReglas: 0 });
    });
  });
});
