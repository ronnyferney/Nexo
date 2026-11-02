import { BudgetsService, type UsageContext } from './budgets.service';
import type { TurnUsage } from '../llm/llm-provider';

/**
 * ADR 0017 Inc.3: la latencia del turno viaja en `UsageContext.latenciaMs` y se persiste en `UsageRecord` junto al
 * costo, sin alterar el cálculo del costo. Se verifica aislando `record()` con un Prisma simulado que captura el
 * `create`.
 */
describe('BudgetsService.record — registro de latencia (ADR 0017 Inc.3)', () => {
  const usage: TurnUsage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 };

  function setup() {
    const create = jest.fn((args: { data: Record<string, unknown> }) => args);
    const prisma = {
      budget: { findMany: jest.fn().mockResolvedValue([]) },
      orgUnit: { findUnique: jest.fn().mockResolvedValue(null) },
      usageRecord: { create },
      $executeRaw: jest.fn(() => ({})),
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const service = new BudgetsService(prisma as never, {} as never, {} as never);
    return { service, prisma, create };
  }

  const ctx = (extra: Partial<UsageContext> = {}): UsageContext => ({
    workspaceId: 'ws1',
    orgUnitId: 'ou1',
    source: 'CHAT',
    agentId: 'a1',
    ...extra,
  });

  it('persiste latenciaMs en el UsageRecord cuando se informa', async () => {
    const { service, create } = setup();
    await service.record(ctx({ latenciaMs: 1234 }), ['ou1'], 'anthropic', 'claude-opus-5-5', usage, 0.01);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.latenciaMs).toBe(1234);
  });

  it('deja latenciaMs indefinido (columna null) cuando no se informa', async () => {
    const { service, create } = setup();
    await service.record(ctx(), ['ou1'], 'anthropic', 'claude-opus-5-5', usage, 0.01);
    expect(create.mock.calls[0][0].data.latenciaMs).toBeUndefined();
  });

  it('la latencia no altera el costo registrado', async () => {
    const { service, create } = setup();
    await service.record(ctx({ latenciaMs: 9999 }), ['ou1'], 'anthropic', 'claude-opus-5-5', usage, 0.25);
    expect(Number(create.mock.calls[0][0].data.costUsd)).toBe(0.25);
  });
});
