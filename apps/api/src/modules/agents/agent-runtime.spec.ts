import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { LlmKind } from '@prisma/client';
import type { ConnectorsService } from '../connectors/connectors.service';
import { BudgetExceededException } from '../governance/budget.errors';
import type { BudgetsService } from '../governance/budgets.service';
import type { OrgService } from '../governance/org.service';
import type { KnowledgeService } from '../knowledge/knowledge.service';
import type { LlmGatewayService, ResolvedModel } from '../llm/llm-gateway.service';
import type { AgentEvent, LlmClient, LlmRunRequest, LlmRunResult } from '../llm/llm-provider';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AgentRuntimeService, isProviderFailure, parseModelRef, type AgentWithTools } from './agent-runtime.service';

type Behavior = (req: LlmRunRequest) => Promise<LlmRunResult>;

const ok =
  (text: string): Behavior =>
  async (req) => ({
    history: [...req.history, { role: 'user', content: req.userMessage }],
    text,
    stopReason: 'end_turn',
    turns: 1,
    usage: { inputTokens: 1, outputTokens: 1 },
  });
const fail =
  (err: unknown): Behavior =>
  async () => {
    throw err;
  };

function setup(
  models: Record<string, { kind: LlmKind; behavior: Behavior }>,
  planOverrides: Record<string, unknown> = {},
) {
  const calls: { key: string; req: LlmRunRequest }[] = [];
  const planned: string[] = [];
  const gateway = {
    resolve: jest.fn(async (_ws: string, providerId: string, model: string): Promise<ResolvedModel> => {
      const key = `${providerId}:${model}`;
      const entry = models[key];
      if (!entry) throw new BadRequestException(`Modelo no disponible: ${key}`);
      const client: LlmClient = {
        test: async () => ({ ok: true, message: '' }),
        run: (req) => {
          calls.push({ key, req });
          return entry.behavior(req);
        },
      };
      return {
        providerId,
        providerLabel: providerId.toUpperCase(),
        kind: entry.kind,
        model,
        client,
        pricing: { id: model, label: model, inputUsdPerMTok: 0, outputUsdPerMTok: 0, cacheReadUsdPerMTok: null },
      } as unknown as ResolvedModel;
    }),
  };
  const budgets = {
    plan: jest.fn(async (_ws: string, _unit: string, providerId: string, model: string) => {
      const key = `${providerId}:${model}`;
      planned.push(key);
      const override = planOverrides[key];
      if (override instanceof Error) throw override;
      return { chainIds: ['root'], providerId, model };
    }),
    assertCanSpend: jest.fn(async () => undefined),
    record: jest.fn(async () => undefined),
  };
  const org = { resolveCostCenter: jest.fn(async () => 'root') };
  const runtime = new AgentRuntimeService(
    gateway as unknown as LlmGatewayService,
    {} as ConnectorsService,
    org as unknown as OrgService,
    budgets as unknown as BudgetsService,
    { connectorOperation: { findMany: async () => [] } } as unknown as PrismaService,
    { search: async () => [] } as unknown as KnowledgeService,
  );
  return { runtime, calls, planned };
}

function agent(fallbackModels: string[]): AgentWithTools {
  const a: AgentWithTools = {
    id: 'a1',
    name: 'Agente',
    description: null,
    provider: 'p1',
    model: 'm1',
    systemPrompt: 'Base',
    effort: 'medium',
    maxTurns: 3,
    profile: {},
    fallbackModels,
    costCenterId: null,
    workspaceId: 'ws',
    createdAt: new Date(),
    updatedAt: new Date(),
    tools: [],
  };
  return a;
}

describe('AgentRuntimeService · cadena de respaldo', () => {
  const history = [{ role: 'user', content: 'antes' }];

  it('usa el respaldo cuando falla el proveedor y conserva el historial solo si el tipo coincide', async () => {
    const { runtime, calls, planned } = setup({
      'p1:m1': { kind: 'OPENAI_COMPATIBLE', behavior: fail(new Error('HTTP 503')) },
      'p2:m2': { kind: 'MOCK', behavior: fail(new Error('caído')) },
      'p3:m3': { kind: 'OPENAI_COMPATIBLE', behavior: ok('listo') },
    });
    const events: AgentEvent[] = [];
    const r = await runtime.run(agent(['p2:m2', 'p3:m3']), {
      message: 'hola',
      history,
      historyProviderId: 'p1',
      context: { source: 'CHAT' },
      onEvent: (e) => events.push(e),
    });
    expect(r).toMatchObject({ text: 'listo', providerId: 'p3', model: 'm3' });
    expect(planned).toEqual(['p1:m1', 'p2:m2', 'p3:m3']);
    expect(calls.map((c) => c.key)).toEqual(['p1:m1', 'p2:m2', 'p3:m3']);
    expect(calls[0].req.history).toEqual(history);
    expect(calls[1].req.history).toEqual([]);
    expect(calls[2].req.history).toEqual(history);
    expect(events.filter((e) => e.type === 'notice').map((e) => (e as { message: string }).message)).toEqual([
      'El modelo m1 (P1) falló; se usa m2 (P2).',
      'El modelo m2 (P2) falló; se usa m3 (P3).',
    ]);
  });

  it('omite respaldos no permitidos o inexistentes y relanza el último error del proveedor si no quedan', async () => {
    const providerError = new Error('HTTP 500');
    const { runtime, calls } = setup(
      { 'p1:m1': { kind: 'ANTHROPIC', behavior: fail(providerError) } },
      { 'p2:m2': new ForbiddenException('no permitido') },
    );
    const events: AgentEvent[] = [];
    await expect(
      runtime.run(agent(['p2:m2', 'p9:m9']), {
        message: 'hola',
        context: { source: 'CHAT' },
        onEvent: (e) => events.push(e),
      }),
    ).rejects.toBe(providerError);
    expect(calls).toHaveLength(1);
    expect(events.map((e) => (e as { message: string }).message)).toEqual([
      expect.stringContaining('m2 no está disponible: no permitido'),
      expect.stringContaining('m9 no está disponible'),
    ]);
  });

  it('no usa respaldos ante presupuesto agotado, errores de la plataforma o cancelación', async () => {
    const budget = new BudgetExceededException('Raíz', '2026-10');
    const s1 = setup({
      'p1:m1': { kind: 'MOCK', behavior: fail(budget) },
      'p2:m2': { kind: 'MOCK', behavior: ok('x') },
    });
    await expect(s1.runtime.run(agent(['p2:m2']), { message: 'h', context: { source: 'CHAT' } })).rejects.toBe(budget);
    expect(s1.calls).toHaveLength(1);

    const controller = new AbortController();
    controller.abort();
    const s2 = setup({
      'p1:m1': { kind: 'MOCK', behavior: fail(new Error('abortado')) },
      'p2:m2': { kind: 'MOCK', behavior: ok('x') },
    });
    await expect(
      s2.runtime.run(agent(['p2:m2']), { message: 'h', context: { source: 'CHAT' }, signal: controller.signal }),
    ).rejects.toThrow('abortado');
    expect(s2.calls).toHaveLength(1);

    // Un presupuesto agotado al planificar un respaldo detiene la cadena.
    const s3 = setup(
      { 'p1:m1': { kind: 'MOCK', behavior: fail(new Error('caído')) }, 'p3:m3': { kind: 'MOCK', behavior: ok('x') } },
      { 'p2:m2': budget },
    );
    await expect(s3.runtime.run(agent(['p2:m2', 'p3:m3']), { message: 'h', context: { source: 'CHAT' } })).rejects.toBe(
      budget,
    );
  });

  it('clasifica errores y referencias de modelo', () => {
    expect(isProviderFailure(new Error('HTTP 503'))).toBe(true);
    expect(isProviderFailure(new BadRequestException('x'))).toBe(false);
    expect(isProviderFailure(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(false);
    expect(parseModelRef('ollama:llama3:8b')).toEqual({ providerId: 'ollama', model: 'llama3:8b' });
    expect(parseModelRef('sin-modelo:')).toBeNull();
    expect(parseModelRef(':m')).toBeNull();
  });
});

describe('AgentRuntimeService · herramientas internas', () => {
  it('load_skill y search_knowledge se resuelven sin pasar por conectores', async () => {
    const searches: unknown[] = [];
    const seen: string[] = [];
    const behavior: Behavior = async (req) => {
      const skill = await req.executeTool({ id: '1', name: 'load_skill', input: { name: 'ventas' } });
      const kb = await req.executeTool({ id: '2', name: 'search_knowledge', input: { query: 'precios' } });
      const unknown = await req.executeTool({ id: '3', name: 'otra', input: {} });
      seen.push(skill.content, kb.content, String(unknown.isError));
      return ok('fin')(req);
    };
    const { runtime, calls } = setup({ 'p1:m1': { kind: 'MOCK', behavior } });
    // Sustituye la búsqueda para verificar los parámetros.
    (runtime as unknown as { knowledge: Partial<KnowledgeService> }).knowledge = {
      search: async (...args: unknown[]) => {
        searches.push(args);
        return [{ documentId: 'd1', title: 'Lista de precios', content: 'Plan básico: 10 USD', score: 0.5 }];
      },
    };
    const a = {
      ...agent([]),
      skills: [
        {
          agentId: 'a1',
          skillId: 's1',
          skill: {
            id: 's1',
            name: 'Ventas',
            slug: 'ventas',
            description: 'Cotizar',
            instructions: 'Paso 1: saluda.',
            operationIds: [],
            workspaceId: 'ws',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ],
      knowledge: [
        { agentId: 'a1', knowledgeBaseId: 'kb1', knowledgeBase: { id: 'kb1', name: 'Precios', description: null } },
      ],
    } as AgentWithTools;
    await runtime.run(a, { message: 'hola', context: { source: 'CHAT' } });
    expect(calls[0].req.tools.map((t) => t.name)).toEqual(['load_skill', 'search_knowledge']);
    expect(calls[0].req.system).toContain('## Habilidades disponibles');
    expect(seen[0]).toBe('# Ventas\n\nPaso 1: saluda.');
    expect(seen[1]).toContain('Documento: Lista de precios');
    expect(seen[1]).toContain('Plan básico: 10 USD');
    expect(seen[2]).toBe('true');
    expect(searches).toEqual([['ws', ['kb1'], 'precios', 5]]);
  });
});
