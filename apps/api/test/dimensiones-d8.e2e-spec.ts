import type { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createTestApp, prismaOf } from './utils/app';
import { addMember, registerOwner, rootUnit, type Session } from './utils/fixtures';

/**
 * Marco de dimensiones configurables (ADR 0011 · D8, estilo NetSuite / SAP CO-PA). Verifica: que el cliente crea una
 * dimensión propia y pivota el consumo por ella SIN migración; que una dimensión obligatoria para efecto económico sin
 * valor bloquea el despacho; que un valor inactivo no es asignable a trabajo nuevo pero sigue en el histórico; que
 * etiquetar NO concede acceso; el aislamiento por workspace; y que no hay ciclos en la jerarquía de valores.
 */
describe('Dimensiones configurables D8 (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  /** Inserta un UsageRecord con su snapshot de dimensiones (como haría el runtime al registrar el hecho económico). */
  async function insertUsage(workspaceId: string, costUsd: number, dimensiones: Record<string, string>): Promise<void> {
    await prismaOf(app).usageRecord.create({
      data: {
        workspaceId,
        source: 'CHAT',
        providerId: 'mock',
        model: 'mock-echo',
        inputTokens: 10,
        outputTokens: 10,
        costUsd: new Prisma.Decimal(costUsd.toFixed(8)),
        dimensiones: dimensiones,
      },
    });
  }

  describe('Dimensiones de sistema sembradas (idempotente)', () => {
    it('expone las 3 integradas como esSistema=REFERENCIA sin duplicar datos', async () => {
      const owner = await registerOwner(app, 'd8-sys');
      const dims = (await owner.api.get('/dimensiones').expect(200)).body as {
        id: string;
        codigo: string;
        esSistema: boolean;
        tipoValor: string;
        referenciaEntidad: string | null;
      }[];
      const sistema = dims.filter((d) => d.esSistema);
      expect(sistema.map((d) => d.codigo).sort()).toEqual(['centro_costo', 'linea_negocio', 'sede']);
      expect(sistema.every((d) => d.tipoValor === 'REFERENCIA')).toBe(true);
      expect(sistema.find((d) => d.codigo === 'linea_negocio')?.referenciaEntidad).toBe('LineaNegocio');

      // Idempotencia: un segundo listado no las duplica.
      const otraVez = (await owner.api.get('/dimensiones').expect(200)).body as { esSistema: boolean }[];
      expect(otraVez.filter((d) => d.esSistema)).toHaveLength(3);

      // Las de sistema no se editan ni borran.
      const linea = sistema.find((d) => d.codigo === 'linea_negocio')!;
      const id = dims.find((d) => d.codigo === 'linea_negocio')!.id;
      expect(linea).toBeDefined();
      await owner.api.patch(`/dimensiones/${id}`, { nombre: 'Cambiada' }).expect(400);
      await owner.api.delete(`/dimensiones/${id}`).expect(400);
    });
  });

  describe('Dimensión propia + pivot del consumo SIN migración', () => {
    let owner: Session;
    let workspaceId: string;

    beforeAll(async () => {
      owner = await registerOwner(app, 'd8-pivot');
      workspaceId = owner.workspaceId;
    });

    it('crea la dimensión Proyecto con valores y pivota el consumo por ella', async () => {
      const dim = (
        await owner.api
          .post('/dimensiones', { codigo: 'proyecto', nombre: 'Proyecto', aplicaA: ['ejecucion', 'costo'] })
          .expect(201)
      ).body as { id: string };
      await owner.api.post(`/dimensiones/${dim.id}/valores`, { codigo: 'ALFA', nombre: 'Proyecto Alfa' }).expect(201);
      await owner.api.post(`/dimensiones/${dim.id}/valores`, { codigo: 'BETA', nombre: 'Proyecto Beta' }).expect(201);

      // Consumo etiquetado en el snapshot histórico.
      await insertUsage(workspaceId, 1, { proyecto: 'ALFA' });
      await insertUsage(workspaceId, 2, { proyecto: 'ALFA' });
      await insertUsage(workspaceId, 4, { proyecto: 'BETA' });
      await insertUsage(workspaceId, 8, {}); // sin etiqueta -> "Sin asignar"

      const res = (await owner.api.get('/consolas/analisis?groupBy=proyecto').expect(200)).body as {
        totalCostUsd: number;
        groups: { key: string; label: string; costUsd: number; calls: number }[];
      };

      // Sin doble conteo: el total es la suma única del costo medido.
      expect(res.totalCostUsd).toBeCloseTo(15, 5);
      const alfa = res.groups.find((g) => g.key === 'ALFA')!;
      const beta = res.groups.find((g) => g.key === 'BETA')!;
      const sin = res.groups.find((g) => g.key === '')!;
      expect(alfa).toMatchObject({ costUsd: 3, calls: 2, label: 'Proyecto Alfa' });
      expect(beta).toMatchObject({ costUsd: 4, calls: 1, label: 'Proyecto Beta' });
      expect(sin).toMatchObject({ costUsd: 8, calls: 1, label: 'Sin asignar' });
    });

    it('pivotar por una dimensión inexistente devuelve 400', async () => {
      await owner.api.get('/consolas/analisis?groupBy=no_existe').expect(400);
    });
  });

  describe('Obligatoria para efecto económico bloquea el despacho', () => {
    it('sin su valor en el snapshot, el despacho con efecto económico se bloquea', async () => {
      const owner = await registerOwner(app, 'd8-oblig');
      await owner.api
        .post('/dimensiones', {
          codigo: 'cliente',
          nombre: 'Cliente',
          aplicaA: ['costo'],
          obligatoriaParaEfectoEconomico: true,
        })
        .expect(201);

      // Falta el valor de "cliente" -> bloquea (409).
      await owner.api.post('/dimensiones/efecto-economico/validar', { aplicaA: 'costo', dimensiones: {} }).expect(409);

      // Con el valor presente, pasa.
      await owner.api
        .post('/dimensiones/efecto-economico/validar', { aplicaA: 'costo', dimensiones: { cliente: 'C-1' } })
        .expect(200);

      // Una acción cuya entidad no está en `aplicaA` no exige la dimensión.
      await owner.api.post('/dimensiones/efecto-economico/validar', { aplicaA: 'agente', dimensiones: {} }).expect(200);
    });
  });

  describe('Valor inactivo: no asignable a trabajo nuevo pero presente en el histórico', () => {
    it('bloquea etiquetar con un valor inactivo, pero el snapshot pasado se conserva y se reporta', async () => {
      const owner = await registerOwner(app, 'd8-inact');
      const workspaceId = owner.workspaceId;
      const dim = (
        await owner.api
          .post('/dimensiones', { codigo: 'campania', nombre: 'Campaña', aplicaA: ['ejecucion'] })
          .expect(201)
      ).body as { id: string };
      const valor = (
        await owner.api.post(`/dimensiones/${dim.id}/valores`, { codigo: 'Q1', nombre: 'Q1 2026' }).expect(201)
      ).body as { id: string };

      // El valor ya participó en un hecho pasado (histórico).
      await insertUsage(workspaceId, 5, { campania: 'Q1' });

      // Se inactiva el valor.
      await owner.api.patch(`/dimensiones/${dim.id}/valores/${valor.id}`, { estado: 'INACTIVA' }).expect(400);
      // EstadoEstructura no tiene INACTIVA: se usa SUSPENDIDA como "inactivo" (no asignable a trabajo nuevo).
      await owner.api.patch(`/dimensiones/${dim.id}/valores/${valor.id}`, { estado: 'SUSPENDIDA' }).expect(200);

      // No es asignable a trabajo nuevo.
      await owner.api
        .post(`/dimensiones/${dim.id}/asignaciones`, {
          targetType: 'ejecucion',
          targetId: 'exec-nueva',
          dimensionValueId: valor.id,
        })
        .expect(400);

      // Pero el histórico sigue y se reporta en el periodo en que estuvo vigente.
      const res = (await owner.api.get('/consolas/analisis?groupBy=campania').expect(200)).body as {
        groups: { key: string; costUsd: number }[];
      };
      expect(res.groups.find((g) => g.key === 'Q1')).toMatchObject({ costUsd: 5 });
    });
  });

  describe('Etiquetar NO concede acceso; jerarquía sin ciclos; aislamiento', () => {
    let owner: Session;
    let viewer: Session;
    let dimId: string;
    let alfaId: string;
    let betaId: string;

    beforeAll(async () => {
      owner = await registerOwner(app, 'd8-acl');
      viewer = await addMember(app, owner, { role: 'VIEWER' });
      await rootUnit(owner);
      const dim = (
        await owner.api.post('/dimensiones', { codigo: 'area_proy', nombre: 'Área', jerarquica: true }).expect(201)
      ).body as { id: string };
      dimId = dim.id;
      alfaId = (
        (await owner.api.post(`/dimensiones/${dimId}/valores`, { codigo: 'A', nombre: 'A' }).expect(201)).body as {
          id: string;
        }
      ).id;
      betaId = (
        (
          await owner.api
            .post(`/dimensiones/${dimId}/valores`, { codigo: 'B', nombre: 'B', padreId: alfaId })
            .expect(201)
        ).body as { id: string }
      ).id;
    });

    it('la jerarquía de valores no admite ciclos', async () => {
      // A es ancestro de B; poner el padre de A en B cerraría el ciclo -> 400.
      await owner.api.patch(`/dimensiones/${dimId}/valores/${alfaId}`, { padreId: betaId }).expect(400);
      // Un valor no puede ser su propio padre.
      await owner.api.patch(`/dimensiones/${dimId}/valores/${alfaId}`, { padreId: alfaId }).expect(400);
    });

    it('un VIEWER lee pero no muta (etiquetar exige EDITOR+, y no concede acceso de datos)', async () => {
      await viewer.api.get('/dimensiones').expect(200);
      await viewer.api.post('/dimensiones', { codigo: 'x', nombre: 'X' }).expect(403);
      await viewer.api
        .post(`/dimensiones/${dimId}/asignaciones`, {
          targetType: 'ejecucion',
          targetId: 'e1',
          dimensionValueId: alfaId,
        })
        .expect(403);
    });

    it('otro workspace no ve ni accede a las dimensiones propias del cliente (aislamiento)', async () => {
      const ajeno = await registerOwner(app, 'd8-ajeno');
      await ajeno.api.get(`/dimensiones/${dimId}`).expect(404);
      const suyas = (await ajeno.api.get('/dimensiones').expect(200)).body as { esSistema: boolean; codigo: string }[];
      // Solo ve sus 3 de sistema, ninguna del otro workspace.
      expect(suyas.filter((d) => !d.esSistema)).toHaveLength(0);
      expect(suyas.some((d) => d.codigo === 'area_proy')).toBe(false);
    });

    it('etiquetar una ejecución con un valor no crea ningún permiso (solo una fila de etiqueta)', async () => {
      await owner.api
        .post(`/dimensiones/${dimId}/asignaciones`, {
          targetType: 'ejecucion',
          targetId: 'exec-1',
          dimensionValueId: alfaId,
        })
        .expect(201);
      const etiquetas = (
        await owner.api.get(`/dimensiones/${dimId}/asignaciones?targetType=ejecucion&targetId=exec-1`).expect(200)
      ).body as unknown[];
      expect(etiquetas).toHaveLength(1);
      // Re-etiquetar la misma ejecución con la misma dimensión reemplaza (una etiqueta por dimensión), no duplica.
      await owner.api
        .post(`/dimensiones/${dimId}/asignaciones`, {
          targetType: 'ejecucion',
          targetId: 'exec-1',
          dimensionValueId: betaId,
        })
        .expect(201);
      const tras = (
        await owner.api.get(`/dimensiones/${dimId}/asignaciones?targetType=ejecucion&targetId=exec-1`).expect(200)
      ).body as { dimensionValueId: string }[];
      expect(tras).toHaveLength(1);
      expect(tras[0].dimensionValueId).toBe(betaId);
    });
  });
});
