import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type Budget, type OrgUnit, type UsageSource } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LlmGatewayService } from '../llm/llm-gateway.service';
import type { TurnUsage } from '../llm/llm-provider';
import { BudgetExceededException } from './budget.errors';
import { blockingUnit, periodKey, preflight, reachedThresholds, type UnitBudgetState } from './budget-policy';
import { UpsertBudgetDto } from './dto/governance.dto';
import { OrgService } from './org.service';

export interface UsageContext {
  workspaceId: string;
  orgUnitId: string;
  source: UsageSource;
  userId?: string;
  agentId?: string;
  workflowId?: string;
  executionId?: string;
  conversationId?: string;
  /** Trazabilidad de enrutamiento (ADR 0010 D5): código(s) auditable(s) del motivo de selección; `null` sin política. */
  routingReason?: string | null;
  /** Rol del tramo (ADR 0010 D5): `draft`/`verify`/nombre de rol; `null` sin enrutamiento. */
  role?: string | null;
  /**
   * Dimensiones de imputación integradas (ADR 0011 D5/RF45), capturadas como snapshot del hecho económico. Opcionales y
   * aditivas: NO cambian el cálculo del costo (ADR 0002 intacto) ni crean una segunda reserva; son etiquetas de reporte.
   * Si no se informan: `areaEjecutoraId` toma por defecto `orgUnitId` (el área que ejecuta) y `empresaId` se resuelve de
   * la unidad ejecutora en `record()`. `lineaBeneficiariaId`/`centroCostoId`/`sedeId` quedan en `null` si no se dan.
   */
  empresaId?: string | null;
  areaEjecutoraId?: string | null;
  lineaBeneficiariaId?: string | null;
  centroCostoId?: string | null;
  sedeId?: string | null;
  /**
   * Snapshot de dimensiones configurables (ADR 0011 D8): mapa `{ dimensionCodigo: valor }` congelado al momento del
   * hecho. Opcional y aditivo: si no se informa, la columna queda en su default `{}`. NO afecta el cálculo del costo.
   */
  dimensiones?: Prisma.InputJsonValue;
}

export interface SpendPlan {
  chainIds: string[];
  providerId: string;
  model: string;
  notice?: string;
}

const DEFAULT_THRESHOLDS = [50, 80, 100];

/** Bolsas de presupuesto jerárquicas: decisión previa, control por turno, libro mayor y alertas. */
@Injectable()
export class BudgetsService {
  private readonly logger = new Logger(BudgetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly org: OrgService,
    private readonly gateway: LlmGatewayService,
  ) {}

  /** Estado de la cadena unidad → raíz con el gasto del periodo vigente de cada presupuesto. */
  async chainState(workspaceId: string, orgUnitId: string): Promise<UnitBudgetState[]> {
    const chain = await this.org.chain(workspaceId, orgUnitId);
    const budgets = await this.prisma.budget.findMany({ where: { orgUnitId: { in: chain.map((u) => u.id) } } });
    return this.withSpend(chain, budgets);
  }

  async plan(workspaceId: string, orgUnitId: string, providerId: string, model: string): Promise<SpendPlan> {
    const chain = await this.chainState(workspaceId, orgUnitId);
    const decision = preflight(chain, providerId, model);
    const chainIds = chain.map((u) => u.orgUnitId);
    switch (decision.action) {
      case 'forbidden-model':
        throw new ForbiddenException(`El modelo ${model} no está permitido para la unidad "${decision.unitName}"`);
      case 'block':
        throw new BudgetExceededException(decision.unitName, decision.periodKey);
      case 'downgrade':
        return {
          chainIds,
          providerId: decision.providerId,
          model: decision.model,
          notice: `Presupuesto agotado en "${decision.unitName}": se usa el modelo económico ${decision.model}.`,
        };
      default:
        return { chainIds, providerId, model };
    }
  }

  /** Control antes de cada turno del modelo: corta si un presupuesto BLOCK se agotó durante la ejecución. */
  async assertCanSpend(workspaceId: string, orgUnitId: string): Promise<void> {
    const unit = blockingUnit(await this.chainState(workspaceId, orgUnitId));
    if (unit) throw new BudgetExceededException(unit.name, unit.budget!.periodKey);
  }

  /** Registra el consumo y lo descuenta atómicamente de la unidad y todos sus ancestros. */
  async record(
    ctx: UsageContext,
    chainIds: string[],
    providerId: string,
    model: string,
    usage: TurnUsage,
    cost: number,
  ) {
    const budgets = await this.prisma.budget.findMany({ where: { orgUnitId: { in: chainIds } } });
    const now = new Date();
    const keys = new Set(['MONTHLY', 'QUARTERLY', 'YEARLY'].map((p) => periodKey(p as Budget['period'], now)));
    // Captura de las dimensiones de imputación (ADR 0011 D5): el área ejecutora es por defecto la unidad de imputación
    // (`orgUnitId`) y la empresa ejecutora se resuelve de esa unidad. Son etiquetas del gasto medido: NO alteran el
    // costo (ADR 0002 intacto) ni descuentan de otro presupuesto (sin doble reserva).
    const areaEjecutoraId = ctx.areaEjecutoraId ?? ctx.orgUnitId;
    const empresaId = await this.resolveEmpresa(ctx.orgUnitId, ctx.empresaId ?? null);
    await this.prisma.$transaction([
      this.prisma.usageRecord.create({
        data: {
          ...ctx,
          areaEjecutoraId,
          empresaId,
          providerId,
          model,
          ...usage,
          costUsd: new Prisma.Decimal(cost.toFixed(8)),
        },
      }),
      // Se registra en todas las claves de periodo para que un presupuesto creado a mitad de periodo vea el gasto real.
      ...chainIds.flatMap((orgUnitId) =>
        [...keys].map(
          (key) => this.prisma.$executeRaw`
            INSERT INTO "BudgetLedger" ("orgUnitId", "periodKey", "spentUsd", "updatedAt")
            VALUES (${orgUnitId}, ${key}, ${cost}, NOW())
            ON CONFLICT ("orgUnitId", "periodKey")
            DO UPDATE SET "spentUsd" = "BudgetLedger"."spentUsd" + EXCLUDED."spentUsd", "updatedAt" = NOW()`,
        ),
      ),
    ]);
    if (budgets.length) await this.raiseAlerts(budgets, now).catch((e: Error) => this.logger.warn(e.message));
  }

  private async raiseAlerts(budgets: Budget[], now: Date) {
    const ledgers = await this.ledgerFor(budgets, now);
    const alerts = budgets.flatMap((b) => {
      const key = periodKey(b.period, now);
      const spent = ledgers.get(`${b.orgUnitId}:${key}`) ?? 0;
      const limit = Number(b.limitUsd);
      return reachedThresholds(spent, limit, b.alertThresholds).map((threshold) => ({
        orgUnitId: b.orgUnitId,
        periodKey: key,
        threshold,
        spentUsd: new Prisma.Decimal(spent.toFixed(8)),
        limitUsd: b.limitUsd,
      }));
    });
    if (!alerts.length) return;
    const created = await this.prisma.budgetAlert.createMany({ data: alerts, skipDuplicates: true });
    if (created.count) this.logger.warn(`${created.count} alerta(s) de presupuesto nuevas`);
  }

  // ---------- Administración ----------
  async list(workspaceId: string) {
    const units = await this.org.units(workspaceId);
    const budgets = await this.prisma.budget.findMany({ where: { orgUnitId: { in: units.map((u) => u.id) } } });
    const states = await this.withSpend(units, budgets);
    const byUnit = new Map(budgets.map((b) => [b.orgUnitId, b]));
    return units.map((u, i) => {
      const b = byUnit.get(u.id);
      const s = states[i];
      return {
        orgUnitId: u.id,
        orgUnitName: u.name,
        parentId: u.parentId,
        budget: b
          ? {
              period: b.period,
              limitUsd: Number(b.limitUsd),
              policy: b.policy,
              alertThresholds: b.alertThresholds,
              downgradeProviderId: b.downgradeProviderId,
              downgradeModel: b.downgradeModel,
            }
          : null,
        periodKey: s.budget?.periodKey ?? null,
        spentUsd: s.spentUsd,
        pct: s.budget ? (s.budget.limitUsd > 0 ? Math.round((s.spentUsd / s.budget.limitUsd) * 1000) / 10 : 100) : null,
      };
    });
  }

  async upsert(workspaceId: string, orgUnitId: string, dto: UpsertBudgetDto) {
    await this.org.unit(workspaceId, orgUnitId);
    if (dto.policy === 'DOWNGRADE' && dto.downgradeModel) {
      const providerId = dto.downgradeProviderId;
      if (!providerId) throw new BadRequestException('Indique el proveedor del modelo de degradación');
      const catalog = await this.gateway.catalog(workspaceId);
      const exists = catalog.some((c) => c.id === providerId && c.models.some((m) => m.id === dto.downgradeModel));
      if (!exists) {
        throw new BadRequestException(
          `El modelo de degradación ${providerId}:${dto.downgradeModel} no existe o no está habilitado`,
        );
      }
    }
    const data = {
      period: dto.period,
      limitUsd: new Prisma.Decimal(dto.limitUsd),
      policy: dto.policy,
      alertThresholds: [...new Set(dto.alertThresholds ?? DEFAULT_THRESHOLDS)].sort((a, b) => a - b),
      downgradeProviderId: dto.policy === 'DOWNGRADE' ? (dto.downgradeProviderId ?? null) : null,
      downgradeModel: dto.policy === 'DOWNGRADE' ? (dto.downgradeModel ?? null) : null,
    };
    const budget = await this.prisma.budget.upsert({
      where: { orgUnitId },
      create: { orgUnitId, ...data },
      update: data,
    });
    // Un presupuesto nuevo o reducido puede quedar por encima de sus umbrales con el gasto ya acumulado.
    await this.raiseAlerts([budget], new Date());
    return (await this.list(workspaceId)).find((b) => b.orgUnitId === orgUnitId);
  }

  async remove(workspaceId: string, orgUnitId: string) {
    await this.org.unit(workspaceId, orgUnitId);
    await this.prisma.budget.deleteMany({ where: { orgUnitId } });
  }

  async alerts(workspaceId: string) {
    const rows = await this.prisma.budgetAlert.findMany({
      where: { orgUnit: { workspaceId } },
      include: { orgUnit: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((a) => ({
      id: a.id,
      orgUnitId: a.orgUnitId,
      orgUnitName: a.orgUnit.name,
      periodKey: a.periodKey,
      threshold: a.threshold,
      spentUsd: Number(a.spentUsd),
      limitUsd: Number(a.limitUsd),
      createdAt: a.createdAt,
    }));
  }

  // ---------- Internos ----------

  /**
   * Resuelve la empresa ejecutora (ADR 0011 D5) a partir de la unidad de imputación: si la unidad ya es una `EMPRESA`,
   * es ella misma; si no, su `empresaId` desnormalizado. Devuelve el valor ya provisto sin consultar. Si la unidad no
   * existe o no tiene empresa, deja `null` (retrocompatible: el registro se imputa por `orgUnitId` como hoy).
   */
  private async resolveEmpresa(orgUnitId: string, provisto: string | null): Promise<string | null> {
    if (provisto) return provisto;
    const unit = await this.prisma.orgUnit.findUnique({
      where: { id: orgUnitId },
      select: { tipo: true, empresaId: true },
    });
    if (!unit) return null;
    return unit.tipo === 'EMPRESA' ? orgUnitId : unit.empresaId;
  }

  private async withSpend(units: OrgUnit[], budgets: Budget[], now = new Date()): Promise<UnitBudgetState[]> {
    const ledgers = await this.ledgerFor(budgets, now);
    const byUnit = new Map(budgets.map((b) => [b.orgUnitId, b]));
    return units.map((u) => {
      const b = byUnit.get(u.id);
      const key = b ? periodKey(b.period, now) : null;
      return {
        orgUnitId: u.id,
        name: u.name,
        allowedModels: u.allowedModels,
        spentUsd: key ? (ledgers.get(`${u.id}:${key}`) ?? 0) : 0,
        budget: b
          ? {
              policy: b.policy,
              limitUsd: Number(b.limitUsd),
              periodKey: key!,
              downgradeProviderId: b.downgradeProviderId,
              downgradeModel: b.downgradeModel,
            }
          : null,
      };
    });
  }

  private async ledgerFor(budgets: Budget[], now: Date): Promise<Map<string, number>> {
    if (!budgets.length) return new Map();
    const rows = await this.prisma.budgetLedger.findMany({
      where: { OR: budgets.map((b) => ({ orgUnitId: b.orgUnitId, periodKey: periodKey(b.period, now) })) },
    });
    return new Map(rows.map((r) => [`${r.orgUnitId}:${r.periodKey}`, Number(r.spentUsd)]));
  }
}
