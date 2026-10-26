import type { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createTestApp, prismaOf } from './utils/app';
import { addMember, chat, createAgent, publishAgent, registerOwner, rootUnit, type Session } from './utils/fixtures';

/**
 * Costos e imputación / servicios compartidos (ADR 0011 · D5 / E9 · RF44/RF45/RF47 parcial). Verifica:
 *  - Captura de las dimensiones de imputación en `UsageRecord` al registrar el consumo (empresa/área ejecutoras), sin
 *    cambiar el costo (ADR 0002 intacto).
 *  - El reparto de un servicio compartido suma 100 % y aparece UNA SOLA VEZ en el total (sin doble conteo).
 *  - La consolidación por empresa/línea/área/centro cuadra con el costo medido; el estimado se distingue del medido.
 *  - El reparto NO crea reservas de presupuesto (sin doble reserva, ADR 0002 intacto).
 *  - Aislamiento por workspace.
 */
describe('Costos e imputación E9 (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  /** Clave de periodo mensual en UTC (coherente con BudgetLedger): "YYYY-MM". */
  function periodoActual(d = new Date()): string {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  async function createEmpresa(s: Session, name: string, rootId: string): Promise<string> {
    const res = await s.api.post('/admin/org/units', { name, parentId: rootId, tipo: 'EMPRESA' }).expect(201);
    return (res.body as { id: string }).id;
  }

  async function createArea(s: Session, name: string, empresaId: string): Promise<string> {
    const res = await s.api
      .post('/admin/org/units', { name, parentId: empresaId, tipo: 'AREA_FUNCIONAL', empresaId })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  /** Inserta un UsageRecord con sus dimensiones de imputación (como haría el runtime al registrar el hecho). */
  async function insertUsage(
    workspaceId: string,
    costUsd: number,
    dims: { empresaId?: string; areaEjecutoraId?: string; lineaBeneficiariaId?: string; centroCostoId?: string },
  ): Promise<void> {
    await prismaOf(app).usageRecord.create({
      data: {
        workspaceId,
        source: 'CHAT',
        providerId: 'mock',
        model: 'mock-echo',
        inputTokens: 10,
        outputTokens: 10,
        costUsd: new Prisma.Decimal(costUsd.toFixed(8)),
        empresaId: dims.empresaId ?? null,
        areaEjecutoraId: dims.areaEjecutoraId ?? null,
        lineaBeneficiariaId: dims.lineaBeneficiariaId ?? null,
        centroCostoId: dims.centroCostoId ?? null,
      },
    });
  }

  describe('Captura de dimensiones de imputación al registrar el consumo', () => {
    it('el chat puebla empresa y área ejecutoras en UsageRecord sin cambiar el costo', async () => {
      const owner = await registerOwner(app, 'e9-cap');
      const rootId = (await rootUnit(owner)).id;
      const empresaId = await createEmpresa(owner, 'ACME', rootId);
      const areaId = await createArea(owner, 'Operaciones', empresaId);
      const editor = await addMember(app, owner, { role: 'EDITOR', orgUnitId: areaId });
      const agentId = (await createAgent(owner, { name: 'Asistente' })).id;
      await publishAgent(owner, agentId);

      const r = await chat(editor, agentId, 'Hola');
      expect(r.usage.costUsd).toBeGreaterThan(0);

      const rec = await prismaOf(app).usageRecord.findFirst({
        where: { workspaceId: owner.workspaceId, agentId },
        orderBy: { createdAt: 'desc' },
      });
      expect(rec).toBeTruthy();
      // El área ejecutora es la unidad de imputación del usuario; la empresa se resuelve de esa unidad.
      expect(rec!.areaEjecutoraId).toBe(areaId);
      expect(rec!.empresaId).toBe(empresaId);
      // El costo no cambia por capturar dimensiones (ADR 0002 intacto).
      expect(Number(rec!.costUsd)).toBeCloseTo(r.usage.costUsd, 10);
    });
  });

  describe('Servicio compartido: reparto 100 %, consolidación y sin doble conteo', () => {
    let owner: Session;
    let workspaceId: string;
    let empresaId: string;
    let areaDuenoId: string;
    let ln1: string;
    let ln2: string;
    let servicioId: string;
    const periodo = periodoActual();

    beforeAll(async () => {
      owner = await registerOwner(app, 'e9-serv');
      workspaceId = owner.workspaceId;
      const rootId = (await rootUnit(owner)).id;
      empresaId = await createEmpresa(owner, 'Empresa E9', rootId);
      areaDuenoId = await createArea(owner, 'TI (compartido)', empresaId);
      ln1 = (
        await owner.api.post('/estructura/lineas-negocio', { empresaId, codigo: 'LN1', nombre: 'Seguros' }).expect(201)
      ).body.id;
      ln2 = (
        await owner.api.post('/estructura/lineas-negocio', { empresaId, codigo: 'LN2', nombre: 'Banca' }).expect(201)
      ).body.id;

      servicioId = (
        await owner.api
          .post('/servicios-internos', {
            empresaId,
            areaDuenoId,
            codigo: 'SVC-TI',
            nombre: 'Soporte TI',
            acuerdoServicio: { sla: '24h' },
          })
          .expect(201)
      ).body.id;

      // Pool medido del servicio: consumo imputado al área dueña (sin línea), total 100 USD.
      await insertUsage(workspaceId, 60, { empresaId, areaEjecutoraId: areaDuenoId });
      await insertUsage(workspaceId, 40, { empresaId, areaEjecutoraId: areaDuenoId });
      // Consumo medido propio de cada línea (independiente del servicio compartido).
      await insertUsage(workspaceId, 5, { empresaId, lineaBeneficiariaId: ln1 });
      await insertUsage(workspaceId, 3, { empresaId, lineaBeneficiariaId: ln2 });
    });

    it('rechaza un reparto que no suma 100 %, con destino doble o de otra empresa', async () => {
      await owner.api
        .put(`/servicios-internos/${servicioId}/imputaciones`, {
          periodoKey: periodo,
          destinos: [
            { lineaNegocioId: ln1, porcentaje: 60 },
            { lineaNegocioId: ln2, porcentaje: 30 },
          ],
        })
        .expect(400);
      await owner.api
        .put(`/servicios-internos/${servicioId}/imputaciones`, {
          periodoKey: periodo,
          destinos: [
            { lineaNegocioId: ln1, porcentaje: 50 },
            { lineaNegocioId: ln1, porcentaje: 50 },
          ],
        })
        .expect(400);
      // Una línea de otra empresa no es destino válido.
      const otraEmpresa = await createEmpresa(owner, 'Otra Empresa', (await rootUnit(owner)).id);
      const lnAjena = (
        await owner.api
          .post('/estructura/lineas-negocio', { empresaId: otraEmpresa, codigo: 'LNX', nombre: 'Ajena' })
          .expect(201)
      ).body.id;
      await owner.api
        .put(`/servicios-internos/${servicioId}/imputaciones`, {
          periodoKey: periodo,
          destinos: [{ lineaNegocioId: lnAjena, porcentaje: 100 }],
        })
        .expect(400);
    });

    it('acepta un reparto que suma 100 % y lo guarda', async () => {
      const reparto = (
        await owner.api
          .put(`/servicios-internos/${servicioId}/imputaciones`, {
            periodoKey: periodo,
            destinos: [
              { lineaNegocioId: ln1, porcentaje: 60 },
              { lineaNegocioId: ln2, porcentaje: 40 },
            ],
          })
          .expect(200)
      ).body as { porcentaje: string; lineaNegocioId: string }[];
      expect(reparto).toHaveLength(2);

      // Re-aplicar reemplaza (idempotente): no duplica filas para el mismo periodo.
      await owner.api
        .put(`/servicios-internos/${servicioId}/imputaciones`, {
          periodoKey: periodo,
          destinos: [
            { lineaNegocioId: ln1, porcentaje: 60 },
            { lineaNegocioId: ln2, porcentaje: 40 },
          ],
        })
        .expect(200);
      const tras = (await owner.api.get(`/servicios-internos/${servicioId}/imputaciones`).expect(200))
        .body as unknown[];
      expect(tras).toHaveLength(2);
    });

    it('consolida por línea: distingue medido de estimado y el reparto suma el pool (sin doble conteo)', async () => {
      const res = (await owner.api.get(`/consolidacion?dimension=linea&empresaId=${empresaId}`).expect(200)).body as {
        totalMedidoUsd: number;
        totalEstimadoUsd: number;
        groups: { key: string; label: string; costoMedidoUsd: number; costoEstimadoUsd: number }[];
        serviciosCompartidos: { costoMedidoUsd: number; repartido: { destinoId: string; montoUsd: number }[] }[];
      };

      // Medido: pool (100, sin línea) + LN1(5) + LN2(3) = 108, cada registro contado una sola vez.
      expect(res.totalMedidoUsd).toBeCloseTo(108, 6);
      const g1 = res.groups.find((g) => g.key === ln1)!;
      const g2 = res.groups.find((g) => g.key === ln2)!;
      const sinAsignar = res.groups.find((g) => g.key === '')!;
      expect(g1.costoMedidoUsd).toBeCloseTo(5, 6);
      expect(g2.costoMedidoUsd).toBeCloseTo(3, 6);
      expect(sinAsignar.costoMedidoUsd).toBeCloseTo(100, 6); // el pool del servicio, medido, aparece una vez

      // Estimado: el pool de 100 se reparte 60/40 a las líneas servidas.
      expect(g1.costoEstimadoUsd).toBeCloseTo(60, 6);
      expect(g2.costoEstimadoUsd).toBeCloseTo(40, 6);
      expect(res.totalEstimadoUsd).toBeCloseTo(100, 6);

      // El reparto del servicio suma EXACTAMENTE su pool medido (un mismo gasto no se cuenta dos veces).
      const svc = res.serviciosCompartidos[0];
      expect(svc.costoMedidoUsd).toBeCloseTo(100, 6);
      const sumaReparto = svc.repartido.reduce((s, r) => s + r.montoUsd, 0);
      expect(sumaReparto).toBeCloseTo(svc.costoMedidoUsd, 6);
    });

    it('consolida por área y por empresa cuadrando con el costo medido', async () => {
      const porArea = (await owner.api.get(`/consolidacion?dimension=area&empresaId=${empresaId}`).expect(200))
        .body as { groups: { key: string; costoMedidoUsd: number }[] };
      const area = porArea.groups.find((g) => g.key === areaDuenoId)!;
      expect(area.costoMedidoUsd).toBeCloseTo(100, 6);

      const porEmpresa = (await owner.api.get(`/consolidacion?dimension=empresa&empresaId=${empresaId}`).expect(200))
        .body as {
        totalMedidoUsd: number;
        totalEstimadoUsd: number;
        groups: { key: string; costoMedidoUsd: number }[];
      };
      // Todo el consumo pertenece a la empresa: 108, contado una sola vez; sin reasignación entre empresas.
      const emp = porEmpresa.groups.find((g) => g.key === empresaId)!;
      expect(emp.costoMedidoUsd).toBeCloseTo(108, 6);
      expect(porEmpresa.totalEstimadoUsd).toBeCloseTo(0, 6);
    });

    it('el reparto NO crea reservas de presupuesto (sin doble reserva, ADR 0002 intacto)', async () => {
      // La imputación es de reporte: no escribe en BudgetLedger de ninguna unidad del workspace.
      const ledger = await prismaOf(app).budgetLedger.count({
        where: { orgUnit: { workspaceId } },
      });
      expect(ledger).toBe(0);
    });
  });

  describe('Aislamiento por workspace', () => {
    it('otro workspace no ve ni accede a los servicios internos ajenos', async () => {
      const owner = await registerOwner(app, 'e9-iso-a');
      const rootId = (await rootUnit(owner)).id;
      const empresaId = await createEmpresa(owner, 'Dueña', rootId);
      const areaDuenoId = await createArea(owner, 'TI', empresaId);
      const servicioId = (
        await owner.api
          .post('/servicios-internos', { empresaId, areaDuenoId, codigo: 'S1', nombre: 'Soporte' })
          .expect(201)
      ).body.id;

      const ajeno = await registerOwner(app, 'e9-iso-b');
      await ajeno.api.get(`/servicios-internos/${servicioId}`).expect(404);
      const suyos = (await ajeno.api.get('/servicios-internos').expect(200)).body as unknown[];
      expect(suyos).toHaveLength(0);
      // La consolidación del ajeno no ve el consumo del dueño.
      const cons = (await ajeno.api.get('/consolidacion?dimension=empresa').expect(200)).body as {
        totalMedidoUsd: number;
      };
      expect(cons.totalMedidoUsd).toBe(0);
    });

    it('un VIEWER lee pero no muta', async () => {
      const owner = await registerOwner(app, 'e9-viewer');
      const viewer = await addMember(app, owner, { role: 'VIEWER' });
      const rootId = (await rootUnit(owner)).id;
      const empresaId = await createEmpresa(owner, 'Empresa Viewer', rootId);
      const areaDuenoId = await createArea(owner, 'Area Viewer', empresaId);
      await viewer.api.get('/servicios-internos').expect(200);
      await viewer.api
        .post('/servicios-internos', { empresaId, areaDuenoId, codigo: 'XX', nombre: 'Servicio X' })
        .expect(403);
    });
  });
});
