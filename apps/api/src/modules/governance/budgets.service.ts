import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type AgentBudget, type Budget, type OrgUnit, type Role, type UsageSource } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import { LlmGatewayService } from '../llm/llm-gateway.service';
import type { TurnUsage } from '../llm/llm-provider';
import { BudgetExceededException, PilotBudgetException } from './budget.errors';
import {
  blockingUnit,
  degradacionHabilitada,
  overrideVigente,
  periodKey,
  pilotoPermiteProveedor,
  preflight,
  reachedThresholds,
  type UnitBudgetState,
} from './budget-policy';
import {
  GrantBudgetOverrideDto,
  SetPilotDto,
  UpsertAgentBudgetDto,
  UpsertBudgetDto,
  ValidarImpactoDto,
} from './dto/governance.dto';
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
   * Latencia del turno del modelo en milisegundos (ADR 0017 Inc.3): se mide junto al costo y se persiste en
   * `UsageRecord.latenciaMs`. Opcional y aditiva: NO altera el cálculo del costo ni el resultado funcional. Si no se
   * informa, la columna queda en `null`.
   */
  latenciaMs?: number | null;
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

/** Clave sintética de un nodo de bolsa de agente en la cadena de decisión (no es un `orgUnitId` real). */
const agentNodeId = (agentId: string) => `agent:${agentId}`;

/** Umbrales de alerta por defecto (P0.1): 80 / 90 / 100 %. */
const DEFAULT_THRESHOLDS = [80, 90, 100];

/** Bolsas de presupuesto jerárquicas: decisión previa, control por turno, libro mayor y alertas. */
@Injectable()
export class BudgetsService {
  private readonly logger = new Logger(BudgetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly org: OrgService,
    private readonly gateway: LlmGatewayService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Estado de la cadena de decisión con el gasto del periodo vigente de cada bolsa. Va del nodo más cercano a la raíz:
   * si se informa `agentId` y el agente tiene bolsa (P0.1 nivel agente), se antepone como nodo adicional; luego la
   * unidad imputada → ... → raíz. Cada nodo incluye criticidad/validación de impacto (P1.1c) y si tiene override
   * vigente (P0.1).
   */
  async chainState(workspaceId: string, orgUnitId: string, agentId?: string): Promise<UnitBudgetState[]> {
    const chain = await this.org.chain(workspaceId, orgUnitId);
    const now = new Date();
    const budgets = await this.prisma.budget.findMany({ where: { orgUnitId: { in: chain.map((u) => u.id) } } });
    const overrides = await this.activeOverrides(
      workspaceId,
      chain.map((u) => u.id),
      agentId,
      now,
    );
    const states = await this.withSpend(chain, budgets, overrides, now);

    if (agentId) {
      const agentNode = await this.agentState(workspaceId, agentId, overrides, now);
      if (agentNode) return [agentNode, ...states];
    }
    return states;
  }

  async plan(
    workspaceId: string,
    orgUnitId: string,
    providerId: string,
    model: string,
    agentId?: string,
  ): Promise<SpendPlan> {
    // Preset de piloto US$ 0 (P0.1b): con modo piloto activo solo se permite el simulador; cualquier proveedor real se
    // rechaza para que el costo externo sea 0. Es un gobierno de gasto, independiente de las bolsas.
    await this.assertPilot(workspaceId, providerId);
    const chain = await this.chainState(workspaceId, orgUnitId, agentId);
    const decision = preflight(chain, providerId, model);
    const chainIds = chain.filter((u) => !u.orgUnitId.startsWith('agent:')).map((u) => u.orgUnitId);
    switch (decision.action) {
      case 'forbidden-model':
        throw new ForbiddenException(`El modelo ${model} no está permitido para la unidad "${decision.unitName}"`);
      case 'block':
        throw new BudgetExceededException(decision.unitName, decision.periodKey);
      case 'downgrade':
        // Una degradación también debe respetar el preset de piloto (el modelo económico no puede ser de pago real).
        await this.assertPilot(workspaceId, decision.providerId);
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
  async assertCanSpend(workspaceId: string, orgUnitId: string, agentId?: string): Promise<void> {
    const unit = blockingUnit(await this.chainState(workspaceId, orgUnitId, agentId));
    if (unit) throw new BudgetExceededException(unit.name, unit.budget!.periodKey);
  }

  /** Registra el consumo y lo descuenta atómicamente de la unidad, todos sus ancestros y la bolsa del agente (si hay). */
  async record(
    ctx: UsageContext,
    chainIds: string[],
    providerId: string,
    model: string,
    usage: TurnUsage,
    cost: number,
  ) {
    const budgets = await this.prisma.budget.findMany({ where: { orgUnitId: { in: chainIds } } });
    const agentBudget = ctx.agentId
      ? await this.prisma.agentBudget.findUnique({ where: { agentId: ctx.agentId } })
      : null;
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
      // Libro mayor del agente (P0.1 nivel agente): mismo patrón atómico por cada clave de periodo.
      ...(ctx.agentId
        ? [...keys].map(
            (key) => this.prisma.$executeRaw`
              INSERT INTO "AgentBudgetLedger" ("agentId", "periodKey", "spentUsd", "updatedAt")
              VALUES (${ctx.agentId!}, ${key}, ${cost}, NOW())
              ON CONFLICT ("agentId", "periodKey")
              DO UPDATE SET "spentUsd" = "AgentBudgetLedger"."spentUsd" + EXCLUDED."spentUsd", "updatedAt" = NOW()`,
          )
        : []),
    ]);
    if (budgets.length) await this.raiseAlerts(budgets, now).catch((e: Error) => this.logger.warn(e.message));
    if (agentBudget) await this.raiseAgentAlerts([agentBudget], now).catch((e: Error) => this.logger.warn(e.message));
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

  private async raiseAgentAlerts(budgets: AgentBudget[], now: Date) {
    const rows = await this.prisma.agentBudgetLedger.findMany({
      where: { OR: budgets.map((b) => ({ agentId: b.agentId, periodKey: periodKey(b.period, now) })) },
    });
    const ledgers = new Map(rows.map((r) => [`${r.agentId}:${r.periodKey}`, Number(r.spentUsd)]));
    const alerts = budgets.flatMap((b) => {
      const key = periodKey(b.period, now);
      const spent = ledgers.get(`${b.agentId}:${key}`) ?? 0;
      return reachedThresholds(spent, Number(b.limitUsd), b.alertThresholds).map((threshold) => ({
        agentId: b.agentId,
        periodKey: key,
        threshold,
        spentUsd: new Prisma.Decimal(spent.toFixed(8)),
        limitUsd: b.limitUsd,
      }));
    });
    if (!alerts.length) return;
    await this.prisma.agentBudgetAlert.createMany({ data: alerts, skipDuplicates: true });
  }

  // ---------- Administración de bolsas por unidad ----------
  async list(workspaceId: string) {
    const units = await this.org.units(workspaceId);
    const now = new Date();
    const budgets = await this.prisma.budget.findMany({ where: { orgUnitId: { in: units.map((u) => u.id) } } });
    const overrides = await this.activeOverrides(
      workspaceId,
      units.map((u) => u.id),
      undefined,
      now,
    );
    const states = await this.withSpend(units, budgets, overrides, now);
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
              critico: b.critico,
              impactoValidadoAt: b.impactoValidadoAt,
              degradacionHabilitada: degradacionHabilitada({
                critico: b.critico,
                impactoValidado: !!b.impactoValidadoAt,
              }),
            }
          : null,
        periodKey: s.budget?.periodKey ?? null,
        overrideActive: s.budget?.overrideActive ?? false,
        spentUsd: s.spentUsd,
        pct: s.budget ? (s.budget.limitUsd > 0 ? Math.round((s.spentUsd / s.budget.limitUsd) * 1000) / 10 : 100) : null,
      };
    });
  }

  async upsert(workspaceId: string, orgUnitId: string, dto: UpsertBudgetDto) {
    await this.org.unit(workspaceId, orgUnitId);
    await this.validateDowngrade(workspaceId, dto);
    const data = this.budgetData(dto);
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

  /**
   * Registra la validación de impacto de la degradación (P1.1c). Sin este registro una bolsa DOWNGRADE no crítica no
   * puede degradar; por sí solo tampoco basta: el proceso debe estar marcado como no crítico (`critico = false`).
   * ADMIN/OWNER; auditado.
   */
  async validarImpacto(workspaceId: string, orgUnitId: string, dto: ValidarImpactoDto, actor: AuditActor) {
    await this.org.unit(workspaceId, orgUnitId);
    const budget = await this.prisma.budget.findUnique({ where: { orgUnitId } });
    if (!budget) throw new NotFoundException('La unidad no tiene presupuesto');
    await this.prisma.budget.update({
      where: { orgUnitId },
      data: { impactoValidadoAt: new Date(), impactoValidadoPor: actor.userId ?? null, impactoNota: dto.nota ?? null },
    });
    await this.audit.append(workspaceId, {
      actorType: 'USER',
      actorId: actor.userId ?? null,
      action: AUDIT_ACTIONS.PRESUPUESTO_IMPACTO_VALIDADO,
      targetType: 'OrgUnit',
      targetId: orgUnitId,
      resumen: `Validación de impacto de degradación registrada para la unidad ${orgUnitId}`,
      metadata: { nota: dto.nota ?? null },
    });
    return (await this.list(workspaceId)).find((b) => b.orgUnitId === orgUnitId);
  }

  // ---------- Bolsas por agente (P0.1 nivel agente) ----------
  async listAgentBudgets(workspaceId: string) {
    const budgets = await this.prisma.agentBudget.findMany({
      where: { workspaceId },
      include: { agent: { select: { name: true } } },
    });
    const now = new Date();
    const rows = budgets.length
      ? await this.prisma.agentBudgetLedger.findMany({
          where: { OR: budgets.map((b) => ({ agentId: b.agentId, periodKey: periodKey(b.period, now) })) },
        })
      : [];
    const ledgers = new Map(rows.map((r) => [`${r.agentId}:${r.periodKey}`, Number(r.spentUsd)]));
    return budgets.map((b) => {
      const key = periodKey(b.period, now);
      const spentUsd = ledgers.get(`${b.agentId}:${key}`) ?? 0;
      const limitUsd = Number(b.limitUsd);
      return {
        agentId: b.agentId,
        agentName: b.agent.name,
        period: b.period,
        periodKey: key,
        limitUsd,
        policy: b.policy,
        alertThresholds: b.alertThresholds,
        downgradeProviderId: b.downgradeProviderId,
        downgradeModel: b.downgradeModel,
        critico: b.critico,
        impactoValidadoAt: b.impactoValidadoAt,
        spentUsd,
        pct: limitUsd > 0 ? Math.round((spentUsd / limitUsd) * 1000) / 10 : 100,
      };
    });
  }

  async upsertAgentBudget(workspaceId: string, agentId: string, dto: UpsertAgentBudgetDto) {
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, workspaceId } });
    if (!agent) throw new NotFoundException('Agente no encontrado');
    await this.validateDowngrade(workspaceId, dto);
    const data = this.budgetData(dto);
    await this.prisma.agentBudget.upsert({
      where: { agentId },
      create: { agentId, workspaceId, ...data },
      update: data,
    });
    return (await this.listAgentBudgets(workspaceId)).find((b) => b.agentId === agentId);
  }

  async removeAgentBudget(workspaceId: string, agentId: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, workspaceId } });
    if (!agent) throw new NotFoundException('Agente no encontrado');
    await this.prisma.agentBudget.deleteMany({ where: { agentId } });
  }

  // ---------- Override gobernado del bloqueo al 100 % (P0.1) ----------
  /**
   * Concede una autorización expresa para gastar por encima del tope. NO es un bypass permanente: la otorga un ADMIN/
   * OWNER, tiene vigencia (`expiresAt`), alcance acotado (una unidad O un agente, y un periodo) y queda auditada (E13).
   */
  async grantOverride(workspaceId: string, dto: GrantBudgetOverrideDto, actor: AuditActor) {
    const hasUnit = !!dto.orgUnitId;
    const hasAgent = !!dto.agentId;
    if (hasUnit === hasAgent) {
      throw new BadRequestException('Indique exactamente un alcance: orgUnitId o agentId');
    }
    let period: Budget['period'];
    let targetName: string;
    if (hasUnit) {
      const unit = await this.org.unit(workspaceId, dto.orgUnitId!);
      const budget = await this.prisma.budget.findUnique({ where: { orgUnitId: dto.orgUnitId! } });
      if (!budget) throw new BadRequestException('La unidad no tiene presupuesto que autorizar');
      period = budget.period;
      targetName = unit.name;
    } else {
      const agent = await this.prisma.agent.findFirst({ where: { id: dto.agentId!, workspaceId } });
      if (!agent) throw new NotFoundException('Agente no encontrado');
      const budget = await this.prisma.agentBudget.findUnique({ where: { agentId: dto.agentId! } });
      if (!budget) throw new BadRequestException('El agente no tiene presupuesto que autorizar');
      period = budget.period;
      targetName = agent.name;
    }
    const expiresAt = new Date(dto.expiresAt);
    if (expiresAt.getTime() <= Date.now()) throw new BadRequestException('La vigencia (expiresAt) debe ser futura');
    const key = periodKey(period);
    const created = await this.prisma.budgetOverride.create({
      data: {
        workspaceId,
        orgUnitId: dto.orgUnitId ?? null,
        agentId: dto.agentId ?? null,
        periodKey: key,
        motivo: dto.motivo,
        limitExtraUsd: dto.limitExtraUsd !== undefined ? new Prisma.Decimal(dto.limitExtraUsd) : null,
        grantedByUserId: actor.userId ?? null,
        grantedByRole: actor.role,
        expiresAt,
      },
    });
    await this.audit.append(workspaceId, {
      actorType: 'USER',
      actorId: actor.userId ?? null,
      action: AUDIT_ACTIONS.PRESUPUESTO_OVERRIDE_CONCEDIDO,
      targetType: hasUnit ? 'OrgUnit' : 'Agent',
      targetId: (dto.orgUnitId ?? dto.agentId)!,
      resumen: `Autorización expresa de gasto para "${targetName}" (periodo ${key}) hasta ${expiresAt.toISOString()}`,
      metadata: { motivo: dto.motivo, periodKey: key, expiresAt: expiresAt.toISOString(), role: actor.role },
    });
    return this.overrideView(created);
  }

  async listOverrides(workspaceId: string, soloVigentes = false) {
    const now = new Date();
    const rows = await this.prisma.budgetOverride.findMany({
      where: { workspaceId, ...(soloVigentes ? { revokedAt: null, expiresAt: { gt: now } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((o) => this.overrideView(o));
  }

  async revokeOverride(workspaceId: string, id: string, actor: AuditActor) {
    const o = await this.prisma.budgetOverride.findFirst({ where: { id, workspaceId } });
    if (!o) throw new NotFoundException('Autorización no encontrada');
    if (o.revokedAt) return this.overrideView(o);
    const updated = await this.prisma.budgetOverride.update({
      where: { id },
      data: { revokedAt: new Date(), revokedByUserId: actor.userId ?? null },
    });
    await this.audit.append(workspaceId, {
      actorType: 'USER',
      actorId: actor.userId ?? null,
      action: AUDIT_ACTIONS.PRESUPUESTO_OVERRIDE_REVOCADO,
      targetType: o.orgUnitId ? 'OrgUnit' : 'Agent',
      targetId: (o.orgUnitId ?? o.agentId)!,
      resumen: `Autorización expresa de gasto revocada (override ${id})`,
      metadata: { periodKey: o.periodKey },
    });
    return this.overrideView(updated);
  }

  // ---------- Preset de piloto US$ 0 (P0.1b) ----------
  async getPilot(workspaceId: string) {
    const ws = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { modoPiloto: true, modoPilotoDesde: true },
    });
    return { modoPiloto: ws.modoPiloto, desde: ws.modoPilotoDesde };
  }

  /**
   * Activa o desactiva el preset de piloto US$ 0. Lo opera SIEMPRE un humano (ADMIN/OWNER): el controlador exige rol y
   * sesión de usuario, de modo que una instrucción generada por un agente no puede desactivarlo. Cada cambio se audita.
   */
  async setPilot(workspaceId: string, dto: SetPilotDto, actor: AuditActor) {
    if (!actor.userId) {
      throw new ForbiddenException('El modo piloto solo lo cambia un usuario humano autenticado, nunca un agente');
    }
    const ws = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { modoPiloto: dto.modoPiloto, modoPilotoDesde: dto.modoPiloto ? new Date() : null },
      select: { modoPiloto: true, modoPilotoDesde: true },
    });
    await this.audit.append(workspaceId, {
      actorType: 'USER',
      actorId: actor.userId,
      action: AUDIT_ACTIONS.MODO_PILOTO_MODIFICADO,
      targetType: 'Workspace',
      targetId: workspaceId,
      resumen: `Modo piloto US$ 0 ${dto.modoPiloto ? 'activado' : 'desactivado'}`,
      metadata: { modoPiloto: dto.modoPiloto },
    });
    return { modoPiloto: ws.modoPiloto, desde: ws.modoPilotoDesde };
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

  /** Rechaza el consumo con un proveedor real cuando el modo piloto está activo (P0.1b). */
  private async assertPilot(workspaceId: string, providerId: string): Promise<void> {
    if (pilotoPermiteProveedor(providerId)) return;
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { modoPiloto: true } });
    if (ws?.modoPiloto) throw new PilotBudgetException(providerId);
  }

  /** Datos comunes de una bolsa a partir del DTO (unidad o agente). Normaliza umbrales, degradación y criticidad. */
  private budgetData(dto: UpsertBudgetDto | UpsertAgentBudgetDto) {
    return {
      period: dto.period,
      limitUsd: new Prisma.Decimal(dto.limitUsd),
      policy: dto.policy,
      alertThresholds: [...new Set(dto.alertThresholds ?? DEFAULT_THRESHOLDS)].sort((a, b) => a - b),
      downgradeProviderId: dto.policy === 'DOWNGRADE' ? (dto.downgradeProviderId ?? null) : null,
      downgradeModel: dto.policy === 'DOWNGRADE' ? (dto.downgradeModel ?? null) : null,
      critico: dto.critico ?? true,
      // Marcar como crítico limpia cualquier validación de impacto previa (un crítico nunca degrada).
      ...(dto.critico === false ? {} : { impactoValidadoAt: null, impactoValidadoPor: null, impactoNota: null }),
    };
  }

  /** Valida que un modelo de degradación exista y esté habilitado (reutilizado por bolsas de unidad y de agente). */
  private async validateDowngrade(workspaceId: string, dto: UpsertBudgetDto | UpsertAgentBudgetDto) {
    if (dto.policy !== 'DOWNGRADE' || !dto.downgradeModel) return;
    if (!dto.downgradeProviderId) throw new BadRequestException('Indique el proveedor del modelo de degradación');
    const catalog = await this.gateway.catalog(workspaceId);
    const exists = catalog.some(
      (c) => c.id === dto.downgradeProviderId && c.models.some((m) => m.id === dto.downgradeModel),
    );
    if (!exists) {
      throw new BadRequestException(
        `El modelo de degradación ${dto.downgradeProviderId}:${dto.downgradeModel} no existe o no está habilitado`,
      );
    }
  }

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

  /** Overrides vigentes del workspace que aplican a una unidad de `orgUnitIds` o al agente dado (claves `node:periodKey`). */
  private async activeOverrides(
    workspaceId: string,
    orgUnitIds: string[],
    agentId: string | undefined,
    now: Date,
  ): Promise<Set<string>> {
    const rows = await this.prisma.budgetOverride.findMany({
      where: {
        workspaceId,
        revokedAt: null,
        expiresAt: { gt: now },
        OR: [{ orgUnitId: { in: orgUnitIds } }, ...(agentId ? [{ agentId }] : [])],
      },
    });
    const set = new Set<string>();
    for (const o of rows) {
      if (!overrideVigente(o, now)) continue;
      const node = o.orgUnitId ?? (o.agentId ? agentNodeId(o.agentId) : null);
      if (node) set.add(`${node}:${o.periodKey}`);
    }
    return set;
  }

  private async agentState(
    workspaceId: string,
    agentId: string,
    overrides: Set<string>,
    now: Date,
  ): Promise<UnitBudgetState | null> {
    const b = await this.prisma.agentBudget.findUnique({
      where: { agentId },
      include: { agent: { select: { name: true } } },
    });
    if (!b || b.workspaceId !== workspaceId) return null;
    const key = periodKey(b.period, now);
    const ledger = await this.prisma.agentBudgetLedger.findUnique({
      where: { agentId_periodKey: { agentId, periodKey: key } },
    });
    const nodeId = agentNodeId(agentId);
    return {
      orgUnitId: nodeId,
      name: `Agente ${b.agent.name}`,
      allowedModels: [],
      spentUsd: ledger ? Number(ledger.spentUsd) : 0,
      budget: {
        policy: b.policy,
        limitUsd: Number(b.limitUsd),
        periodKey: key,
        downgradeProviderId: b.downgradeProviderId,
        downgradeModel: b.downgradeModel,
        critico: b.critico,
        impactoValidado: !!b.impactoValidadoAt,
        overrideActive: overrides.has(`${nodeId}:${key}`),
      },
    };
  }

  private async withSpend(
    units: OrgUnit[],
    budgets: Budget[],
    overrides: Set<string>,
    now: Date,
  ): Promise<UnitBudgetState[]> {
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
              critico: b.critico,
              impactoValidado: !!b.impactoValidadoAt,
              overrideActive: overrides.has(`${u.id}:${key}`),
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

  private overrideView(o: {
    id: string;
    orgUnitId: string | null;
    agentId: string | null;
    periodKey: string;
    motivo: string;
    limitExtraUsd: Prisma.Decimal | null;
    grantedByUserId: string | null;
    grantedByRole: Role;
    expiresAt: Date;
    revokedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: o.id,
      orgUnitId: o.orgUnitId,
      agentId: o.agentId,
      periodKey: o.periodKey,
      motivo: o.motivo,
      limitExtraUsd: o.limitExtraUsd !== null ? Number(o.limitExtraUsd) : null,
      grantedByUserId: o.grantedByUserId,
      grantedByRole: o.grantedByRole,
      expiresAt: o.expiresAt,
      revokedAt: o.revokedAt,
      vigente: overrideVigente(o),
      createdAt: o.createdAt,
    };
  }
}

/** Actor humano de una operación de gobierno (de `@CurrentAuth()`), para la auditoría. */
export interface AuditActor {
  userId?: string;
  role: Role;
}
