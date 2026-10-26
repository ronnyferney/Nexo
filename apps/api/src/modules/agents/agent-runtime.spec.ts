import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { LlmKind } from '@prisma/client';
import type { ConnectorsService } from '../connectors/connectors.service';
import { BudgetExceededException } from '../governance/budget.errors';
import type { BudgetsService } from '../governance/budgets.service';
import type { OrgService } from '../governance/org.service';
import type { KnowledgeService } from '../knowledge/knowledge.service';
import type { LlmGatewayService, ResolvedModel } from '../llm/llm-gateway.service';
import type { AgentEvent, LlmClient, LlmRunRequest, LlmRunResult } from '../llm/llm-provider';
import { ModelRouterService } from '../llm/model-router.service';
import type { RoutingCandidate } from '../llm/routing.types';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AgentRuntimeService, isProviderFailure, parseModelRef, type AgentWithTools } from './agent-runtime.service';
import { AgentVerificationService } from './agent-verification.service';

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
  routingCandidates: RoutingCandidate[] = [],
) {
  const calls: { key: string; req: LlmRunRequest }[] = [];
  const planned: string[] = [];
  const gateway = {
    routingCandidates: jest.fn(async () => routingCandidates),
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
    new ModelRouterService(),
    new AgentVerificationService(),
  );
  return { runtime, calls, planned, gateway, budgets };
}

function agent(fallbackModels: string[]): AgentWithTools {
  const a: AgentWithTools = {
    id: 'a1',
    name: 'Agente',
    description: null,
    icon: null,
    provider: 'p1',
    model: 'm1',
    systemPrompt: 'Base',
    effort: 'medium',
    maxTurns: 3,
    profile: {},
    fallbackModels,
    targetScore: 0.85,
    launchStatus: 'LAUNCHED',
    launchedAt: null,
    launchOverrideReason: null,
    visibility: 'WORKSPACE',
    ownerId: null,
    costCenterId: null,
    cargoId: null,
    responsableUserId: null,
    suplenteUserId: null,
    reportaAAgentId: null,
    estacionVirtualId: null,
    salidaInternet: false,
    parametrosEjecucion: {},
    routing: null,
    workspaceId: 'ws',
    createdAt: new Date(),
    updatedAt: new Date(),
    tools: [],
  };
  return a;
}

/** Candidato de catálogo para las pruebas de enrutamiento (valores por defecto de propósito general, con tarifa). */
function candidate(ref: string, over: Partial<RoutingCandidate> = {}): RoutingCandidate {
  const [providerId, modelId] = ref.split(':');
  return {
    providerId,
    modelId,
    tier: 'STANDARD',
    specialties: ['GENERAL'],
    contextTokens: null,
    inputUsdPerMTok: 1,
    outputUsdPerMTok: 2,
    needsPricing: false,
    ...over,
  };
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

describe('AgentRuntimeService · enrutamiento multi-modelo (ADR 0010)', () => {
  const routed = (routing: unknown): AgentWithTools => ({ ...agent([]), routing: routing as never });
  const noticeMessages = (events: AgentEvent[]) =>
    events.filter((e) => e.type === 'notice').map((e) => (e as { message: string }).message);

  it('routing = null: no invoca al router y usa el principal + fallbackModels de siempre', async () => {
    const { runtime, calls, planned, gateway } = setup({
      'p1:m1': { kind: 'MOCK', behavior: ok('estático') },
    });
    const r = await runtime.run(agent(['p2:m2']), { message: 'hola', context: { source: 'CHAT' } });
    expect(r).toMatchObject({ text: 'estático', providerId: 'p1', model: 'm1' });
    expect(gateway.routingCandidates).not.toHaveBeenCalled();
    expect(planned).toEqual(['p1:m1']);
    expect(calls.map((c) => c.key)).toEqual(['p1:m1']);
  });

  it('ordena por objetivo (cost) y resuelve el candidato más económico, con notice auditable', async () => {
    const { runtime, calls, planned, gateway } = setup({ 'p1:cheap': { kind: 'MOCK', behavior: ok('barato') } }, {}, [
      candidate('p1:premium', { tier: 'PREMIUM', inputUsdPerMTok: 4, outputUsdPerMTok: 20 }),
      candidate('p1:cheap', { tier: 'ECONOMY', inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 }),
      candidate('p1:mid', { tier: 'STANDARD' }),
    ]);
    const events: AgentEvent[] = [];
    const r = await runtime.run(routed({ objective: 'cost' }), {
      message: 'hola',
      context: { source: 'CHAT' },
      onEvent: (e) => events.push(e),
    });
    expect(gateway.routingCandidates).toHaveBeenCalledWith('ws');
    expect(r).toMatchObject({ text: 'barato', providerId: 'p1', model: 'cheap' });
    // El principal enrutado pasa por budgets.plan y gateway.resolve, igual que un respaldo.
    expect(planned[0]).toBe('p1:cheap');
    expect(calls[0].key).toBe('p1:cheap');
    const notices = noticeMessages(events);
    expect(notices.some((m) => m.includes('modelo principal p1:cheap') && m.includes('OBJETIVO_COSTO'))).toBe(true);
  });

  it('omite con aviso un candidato enrutado no permitido y usa el siguiente (gobierno de costos)', async () => {
    const { runtime, calls, planned } = setup(
      { 'p1:mid': { kind: 'MOCK', behavior: ok('permitido') } },
      { 'p1:cheap': new ForbiddenException('modelo no permitido por la unidad') },
      [
        candidate('p1:cheap', { tier: 'ECONOMY', inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 }),
        candidate('p1:mid', { tier: 'STANDARD' }),
      ],
    );
    const events: AgentEvent[] = [];
    const r = await runtime.run(routed({ objective: 'cost' }), {
      message: 'hola',
      context: { source: 'CHAT' },
      onEvent: (e) => events.push(e),
    });
    expect(r).toMatchObject({ providerId: 'p1', model: 'mid' });
    expect(planned).toEqual(['p1:cheap', 'p1:mid']);
    expect(calls.map((c) => c.key)).toEqual(['p1:mid']);
    expect(noticeMessages(events).some((m) => m.includes('cheap no está disponible'))).toBe(true);
  });

  it('el presupuesto agotado detiene la cadena enrutada (no sigue gastando)', async () => {
    const budget = new BudgetExceededException('Raíz', '2026-10');
    const { runtime, calls } = setup(
      { 'p1:mid': { kind: 'MOCK', behavior: ok('no debería') } },
      { 'p1:cheap': budget },
      [
        candidate('p1:cheap', { tier: 'ECONOMY', inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 }),
        candidate('p1:mid', { tier: 'STANDARD' }),
      ],
    );
    await expect(
      runtime.run(routed({ objective: 'cost' }), { message: 'h', context: { source: 'CHAT' } }),
    ).rejects.toBe(budget);
    expect(calls).toHaveLength(0);
  });

  it('la regla por capacidad (VISION) prefiere el modelo adecuado cuando la entrada trae imágenes', async () => {
    const { runtime, calls } = setup({ 'p1:vista': { kind: 'MOCK', behavior: ok('con visión') } }, {}, [
      candidate('p1:texto', { tier: 'ECONOMY', inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 }),
      candidate('p1:vista', { tier: 'PREMIUM', specialties: ['VISION'], inputUsdPerMTok: 4, outputUsdPerMTok: 20 }),
    ]);
    // El historial nativo trae un bloque de imagen: señal determinista de modalidad.
    const r = await runtime.run(routed({ objective: 'cost' }), {
      message: 'describe',
      history: [{ role: 'user', content: [{ type: 'image' }] }],
      context: { source: 'CHAT' },
    });
    // Aun con objetivo cost, el filtro por capacidad deja solo el modelo con VISION.
    expect(r).toMatchObject({ model: 'vista' });
    expect(calls.map((c) => c.key)).toEqual(['p1:vista']);
  });

  it('sin candidatos válidos (contexto insuficiente) vuelve a la configuración por defecto del agente', async () => {
    const { runtime, planned } = setup({ 'p1:m1': { kind: 'MOCK', behavior: ok('por defecto') } }, {}, [
      candidate('p1:corto', { contextTokens: 1 }),
    ]);
    const events: AgentEvent[] = [];
    const r = await runtime.run(
      // El contexto estimado del mensaje largo supera la ventana del único candidato (1 token): se descarta todo.
      { ...agent(['p2:m2']), routing: { objective: 'cost' } },
      { message: 'hola '.repeat(200), context: { source: 'CHAT' }, onEvent: (e) => events.push(e) },
    );
    expect(r).toMatchObject({ providerId: 'p1', model: 'm1' });
    expect(planned[0]).toBe('p1:m1');
    expect(noticeMessages(events).some((m) => m.includes('no encontró candidatos'))).toBe(true);
  });

  it('un routing con forma inválida se ignora (se comporta como null)', async () => {
    const { runtime, gateway, planned } = setup({ 'p1:m1': { kind: 'MOCK', behavior: ok('ok') } });
    await runtime.run(routed({ objetivo: 'malformado' }), { message: 'hola', context: { source: 'CHAT' } });
    expect(gateway.routingCandidates).not.toHaveBeenCalled();
    expect(planned).toEqual(['p1:m1']);
  });
});

describe('AgentRuntimeService · traza de rol/razón de enrutamiento en el consumo (ADR 0010 D5)', () => {
  const routed = (routing: unknown): AgentWithTools => ({ ...agent([]), routing: routing as never });
  // Comportamiento que reporta consumo (dispara `onUsage` → `budgets.record`, donde se persiste la traza).
  const reporting: Behavior = async (req) => {
    await req.onUsage?.({ inputTokens: 2, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 });
    return ok('ok')(req);
  };
  type RecordCtx = { routingReason: string | null; role: string | null };
  const lastRecordCtx = (budgets: ReturnType<typeof setup>['budgets']): RecordCtx => {
    const calls = (budgets.record as jest.Mock).mock.calls as [RecordCtx, ...unknown[]][];
    return calls[calls.length - 1][0];
  };

  it('un turno enrutado imputa el consumo con el motivo auditable (código) y el rol del tramo', async () => {
    const { runtime, budgets } = setup({ 'p1:cheap': { kind: 'MOCK', behavior: reporting } }, {}, [
      candidate('p1:cheap', { tier: 'ECONOMY', inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 }),
    ]);
    await runtime.run(routed({ objective: 'cost' }), { message: 'hola', context: { source: 'CHAT' } });
    expect(budgets.record).toHaveBeenCalledTimes(1);
    const ctx = lastRecordCtx(budgets);
    expect(ctx.role).toBe('draft');
    // El motivo es un código auditable del router, nunca texto libre del modelo.
    expect(ctx.routingReason).toContain('OBJETIVO_COSTO');
  });

  it('un turno sin política (routing=null) deja motivo y rol en null (comportamiento actual)', async () => {
    const { runtime, budgets } = setup({ 'p1:m1': { kind: 'MOCK', behavior: reporting } });
    await runtime.run(agent([]), { message: 'hola', context: { source: 'CHAT' } });
    expect(budgets.record).toHaveBeenCalledTimes(1);
    const ctx = lastRecordCtx(budgets);
    expect(ctx.routingReason).toBeNull();
    expect(ctx.role).toBeNull();
  });

  it('en modo enrutado, un respaldo por fallo del proveedor conserva su propio motivo auditable', async () => {
    const { runtime, budgets } = setup(
      {
        'p1:caro': { kind: 'MOCK', behavior: fail(new Error('HTTP 503')) },
        'p1:barato': { kind: 'MOCK', behavior: reporting },
      },
      {},
      [
        candidate('p1:caro', { tier: 'PREMIUM', inputUsdPerMTok: 4, outputUsdPerMTok: 20 }),
        candidate('p1:barato', { tier: 'ECONOMY', inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 }),
      ],
    );
    // Objetivo calidad: el router pone primero el PREMIUM (que falla) y recurre al segundo candidato.
    const r = await runtime.run(routed({ objective: 'quality' }), { message: 'hola', context: { source: 'CHAT' } });
    expect(r).toMatchObject({ model: 'barato' });
    const ctx = lastRecordCtx(budgets);
    expect(ctx.role).toBe('draft');
    expect(ctx.routingReason).toContain('OBJETIVO_CALIDAD');
  });
});

describe('AgentRuntimeService · verificación cruzada redactor+verificador (ADR 0010 D4, fase 3)', () => {
  const noticeMessages = (events: AgentEvent[]) =>
    events.filter((e) => e.type === 'notice').map((e) => (e as { message: string }).message);
  type RecordCtx = { routingReason: string | null; role: string | null };
  const recordCtxs = (budgets: ReturnType<typeof setup>['budgets']): RecordCtx[] => {
    const calls = (budgets.record as jest.Mock).mock.calls as [RecordCtx, ...unknown[]][];
    return calls.map((c) => c[0]);
  };

  // Redactor: reporta consumo (para imputar role='draft') y responde `text`.
  const drafts =
    (text: string): Behavior =>
    async (req) => {
      await req.onUsage?.({ inputTokens: 2, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 });
      return ok(text)(req);
    };
  // Verificador: reporta consumo (para imputar role='verify') y devuelve un veredicto con el formato acordado.
  const verifies =
    (verdict: string): Behavior =>
    async (req) => {
      await req.onUsage?.({ inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 });
      return {
        history: [],
        text: verdict,
        stopReason: 'end_turn',
        turns: 1,
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    };

  /** Agente enrutado con una herramienta sensible (requiere aprobación): base de las pruebas de acción sensible. */
  const sensitiveOp = {
    id: 'op1',
    key: 'enviar',
    name: 'Enviar correo',
    description: 'Envía un correo al exterior',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    connector: { name: 'correo' },
  };
  const SENSITIVE_TOOL = 'correo__enviar';
  const withVerify = (verify: unknown, sensitive = false): AgentWithTools => ({
    ...agent([]),
    routing: { objective: 'cost', verify } as never,
    tools: sensitive ? ([{ operationId: 'op1', requiresApproval: true, operation: sensitiveOp }] as never) : [],
  });
  // Dos candidatos de distinto proveedor: con objetivo `cost`, el ECONOMY redacta y el otro (otro proveedor) verifica.
  const pair = (): RoutingCandidate[] => [
    candidate('p1:draft', { tier: 'ECONOMY', inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 }),
    candidate('p2:judge', { tier: 'STANDARD' }),
  ];

  it('OK informativo: redacta uno, verifica otro (distinto proveedor) y ambos imputan su consumo (draft/verify)', async () => {
    const { runtime, calls, planned, budgets } = setup(
      {
        'p1:draft': { kind: 'MOCK', behavior: drafts('respuesta') },
        'p2:judge': { kind: 'MOCK', behavior: verifies('VEREDICTO: OK todo respaldado por las fuentes') },
      },
      {},
      pair(),
    );
    const events: AgentEvent[] = [];
    const r = await runtime.run(withVerify({ enabled: true, requireDifferentProvider: true }), {
      message: 'hola',
      context: { source: 'CHAT' },
      onEvent: (e) => events.push(e),
    });
    expect(r.text).toBe('respuesta');
    expect(r.verification).toMatchObject({
      verdict: 'OK',
      code: 'VERIFICACION_OK',
      requiresHumanReview: false,
      verifier: { providerId: 'p2', model: 'judge' },
    });
    expect(calls.map((c) => c.key)).toEqual(['p1:draft', 'p2:judge']);
    // El verificador corre en un turno sin herramientas ni historial (orquestación por encima del gateway).
    expect(calls[1].req.tools).toEqual([]);
    expect(calls[1].req.history).toEqual([]);
    expect(planned).toEqual(['p1:draft', 'p2:judge']);
    const ctxs = recordCtxs(budgets);
    expect(ctxs).toContainEqual(expect.objectContaining({ role: 'draft' }));
    expect(ctxs).toContainEqual(expect.objectContaining({ role: 'verify', routingReason: 'VERIFICACION_CRUZADA' }));
    expect(noticeMessages(events).some((m) => m.includes('VERIFICACION_OK'))).toBe(true);
  });

  it('PROBLEMA en tarea informativa: solo advierte, no bloquea y devuelve el borrador', async () => {
    const { runtime, calls } = setup(
      {
        'p1:draft': { kind: 'MOCK', behavior: drafts('respuesta informativa') },
        'p2:judge': { kind: 'MOCK', behavior: verifies('VEREDICTO: PROBLEMA la fecha no coincide con la fuente') },
      },
      {},
      pair(),
    );
    const events: AgentEvent[] = [];
    const r = await runtime.run(withVerify({ enabled: true, requireDifferentProvider: true }), {
      message: 'hola',
      context: { source: 'CHAT' },
      onEvent: (e) => events.push(e),
    });
    expect(r.text).toBe('respuesta informativa');
    expect(r.verification).toMatchObject({ code: 'VERIFICACION_ADVERTENCIA', requiresHumanReview: false });
    expect(calls.map((c) => c.key)).toEqual(['p1:draft', 'p2:judge']);
    const msg = noticeMessages(events).find((m) => m.includes('VERIFICACION_ADVERTENCIA'));
    expect(msg).toContain('la fecha no coincide con la fuente');
  });

  it('PROBLEMA antes de una acción sensible: exige revisión humana (no ejecuta la acción sola)', async () => {
    const invoked: unknown[] = [];
    const { runtime } = setup(
      {
        'p1:draft': {
          kind: 'MOCK',
          behavior: async (req) => {
            await req.onUsage?.({ inputTokens: 2, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 });
            // El redactor intenta la acción sensible sin aprobación: queda pendiente de confirmación humana.
            await req.executeTool({ id: 't1', name: SENSITIVE_TOOL, input: {} });
            return ok('Voy a enviar el correo, ¿me autorizas?')(req);
          },
        },
        'p2:judge': { kind: 'MOCK', behavior: verifies('VEREDICTO: PROBLEMA el destinatario parece incorrecto') },
      },
      {},
      pair(),
    );
    (runtime as unknown as { connectors: { invoke: jest.Mock } }).connectors = {
      invoke: jest.fn(async (...a: unknown[]) => void invoked.push(a) as unknown as never),
    };
    const events: AgentEvent[] = [];
    const r = await runtime.run(withVerify({ enabled: true, requireDifferentProvider: true }, true), {
      message: 'envía el correo',
      context: { source: 'CHAT' },
      onEvent: (e) => events.push(e),
    });
    expect(r.verification).toMatchObject({ code: 'VERIFICACION_REVISION_HUMANA', requiresHumanReview: true });
    expect(invoked).toHaveLength(0); // la acción sensible no se ejecutó
    expect(noticeMessages(events).some((m) => m.includes('revisión humana'))).toBe(true);
  });

  it('onIssue=warn nunca bloquea aunque haya una acción sensible pendiente', async () => {
    const { runtime } = setup(
      {
        'p1:draft': {
          kind: 'MOCK',
          behavior: async (req) => {
            await req.onUsage?.({ inputTokens: 2, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 });
            await req.executeTool({ id: 't1', name: SENSITIVE_TOOL, input: {} });
            return ok('pido autorización')(req);
          },
        },
        'p2:judge': { kind: 'MOCK', behavior: verifies('VEREDICTO: PROBLEMA revisa esto') },
      },
      {},
      pair(),
    );
    const r = await runtime.run(withVerify({ enabled: true, requireDifferentProvider: true, onIssue: 'warn' }, true), {
      message: 'envía el correo',
      context: { source: 'CHAT' },
    });
    expect(r.verification).toMatchObject({ code: 'VERIFICACION_ADVERTENCIA', requiresHumanReview: false });
  });

  it('sin verificador independiente (requireDifferentProvider y solo mismo proveedor) omite la verificación con aviso', async () => {
    const { runtime, calls } = setup({ 'p1:draft': { kind: 'MOCK', behavior: drafts('respuesta') } }, {}, [
      candidate('p1:draft', { tier: 'ECONOMY', inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 }),
      candidate('p1:judge', { tier: 'STANDARD' }),
    ]);
    const events: AgentEvent[] = [];
    const r = await runtime.run(withVerify({ enabled: true, requireDifferentProvider: true }), {
      message: 'hola',
      context: { source: 'CHAT' },
      onEvent: (e) => events.push(e),
    });
    expect(r.text).toBe('respuesta');
    expect(r.verification).toBeUndefined();
    expect(calls.map((c) => c.key)).toEqual(['p1:draft']);
    expect(noticeMessages(events).some((m) => m.includes('VERIFICACION_OMITIDA'))).toBe(true);
  });

  it('verify.enabled=false se comporta como la fase 2 (no invoca verificador)', async () => {
    const { runtime, calls, budgets } = setup(
      { 'p1:draft': { kind: 'MOCK', behavior: drafts('respuesta') } },
      {},
      pair(),
    );
    const r = await runtime.run(withVerify({ enabled: false }), { message: 'hola', context: { source: 'CHAT' } });
    expect(r.verification).toBeUndefined();
    expect(calls.map((c) => c.key)).toEqual(['p1:draft']);
    expect(recordCtxs(budgets).some((c) => c.role === 'verify')).toBe(false);
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
        {
          agentId: 'a1',
          knowledgeBaseId: 'kb1',
          canWrite: false,
          knowledgeBase: { id: 'kb1', name: 'Precios', description: null },
        },
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

  it('save_knowledge solo está disponible con una base escribible y guarda en la primera', async () => {
    const kbBase = (canWrite: boolean) => ({
      agentId: 'a1',
      knowledgeBaseId: 'kb1',
      canWrite,
      knowledgeBase: { id: 'kb1', name: 'Memoria', description: null },
    });

    // Sin base escribible: la tool no se ofrece y, si se invoca igual, es desconocida.
    {
      let names: string[] = [];
      const outcomes: ToolOutcomeLike[] = [];
      const behavior: Behavior = async (req) => {
        names = req.tools.map((t) => t.name);
        outcomes.push(await req.executeTool({ id: '1', name: 'save_knowledge', input: { title: 't', content: 'c' } }));
        return ok('fin')(req);
      };
      const { runtime } = setup({ 'p1:m1': { kind: 'MOCK', behavior } });
      const added: unknown[] = [];
      (runtime as unknown as { knowledge: Partial<KnowledgeService> }).knowledge = {
        addDocument: async (...args: unknown[]) => void added.push(args) as unknown as never,
      };
      await runtime.run(
        { ...agent([]), knowledge: [kbBase(false)] },
        {
          message: 'hola',
          context: { source: 'CHAT' },
        },
      );
      expect(names).toEqual(['search_knowledge']);
      expect(outcomes[0].isError).toBe(true);
      expect(added).toHaveLength(0);
    }

    // Con base escribible: la tool aparece y persiste el documento.
    {
      let names: string[] = [];
      const outcomes: ToolOutcomeLike[] = [];
      const behavior: Behavior = async (req) => {
        names = req.tools.map((t) => t.name);
        outcomes.push(
          await req.executeTool({
            id: '1',
            name: 'save_knowledge',
            input: { title: 'Perfil de Ana', content: 'Gerenta de compras; prefiere correos breves.' },
          }),
        );
        return ok('fin')(req);
      };
      const { runtime, calls } = setup({ 'p1:m1': { kind: 'MOCK', behavior } });
      const added: unknown[] = [];
      (runtime as unknown as { knowledge: Partial<KnowledgeService> }).knowledge = {
        addDocument: async (...args: unknown[]) => void added.push(args) as unknown as never,
      };
      await runtime.run(
        { ...agent([]), knowledge: [kbBase(true)] },
        {
          message: 'hola',
          context: { source: 'CHAT' },
        },
      );
      expect(names).toEqual(['search_knowledge', 'save_knowledge']);
      expect(calls[0].req.system).toContain('`save_knowledge`');
      expect(outcomes[0].isError).toBeFalsy();
      expect(outcomes[0].content).toBe('Guardado en la base de conocimiento: Perfil de Ana');
      expect(added).toEqual([
        ['ws', 'kb1', { title: 'Perfil de Ana', text: 'Gerenta de compras; prefiere correos breves.' }],
      ]);
    }
  });
});

interface ToolOutcomeLike {
  content: string;
  isError?: boolean;
}

interface AgentRunSpy {
  create: jest.Mock;
  update: jest.Mock;
}

/** Construye un runtime de `setup` pero con un Prisma que expone `agentRun` (y `connectorOperation` para `prepare`). */
function withAgentRun(models: Parameters<typeof setup>[0], agentRun: AgentRunSpy) {
  const base = setup(models);
  (base.runtime as unknown as { prisma: unknown }).prisma = {
    connectorOperation: { findMany: async () => [] },
    agentRun,
  };
  return base;
}

describe('AgentRuntimeService · instrumentación AgentRun (RX-14)', () => {
  it('registra la ejecución con estado, timings y consumo acumulado', async () => {
    const created: Record<string, unknown>[] = [];
    const updated: { where: unknown; data: Record<string, unknown> }[] = [];
    const agentRun: AgentRunSpy = {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => void created.push(data)),
      update: jest.fn(
        async ({ where, data }: { where: unknown; data: Record<string, unknown> }) =>
          void updated.push({ where, data }),
      ),
    };
    // Comportamiento que emite un token de texto (para medir ttft) y reporta consumo (para acumular tokens y costo).
    const streaming: Behavior = async (req) => {
      req.onEvent?.({ type: 'text', text: 'hola ' });
      await req.onUsage?.({ inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 });
      return ok('listo')(req);
    };
    const { runtime } = withAgentRun({ 'p1:m1': { kind: 'MOCK', behavior: streaming } }, agentRun);

    const r = await runtime.run(agent([]), {
      message: 'hola',
      context: { source: 'CHAT', userId: 'u1', conversationId: 'c1' },
    });

    expect(r.text).toBe('listo');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      workspaceId: 'ws',
      agentId: 'a1',
      userId: 'u1',
      source: 'CHAT',
      status: 'RUNNING',
      conversationId: 'c1',
    });
    expect(updated).toHaveLength(1);
    expect(updated[0].where).toEqual({ id: created[0].id });
    expect(updated[0].data).toMatchObject({
      status: 'SUCCEEDED',
      providerId: 'p1',
      model: 'm1',
      inputTokens: 1,
      outputTokens: 1,
    });
    expect(typeof updated[0].data.durationMs).toBe('number');
    expect(typeof updated[0].data.ttftMs).toBe('number');
  });

  it('un fallo al registrar (BD caída) NO rompe la ejecución: el agente responde igual', async () => {
    const dbDown = async () => {
      throw new Error('BD caída');
    };
    const agentRun: AgentRunSpy = { create: jest.fn(dbDown), update: jest.fn(dbDown) };
    const { runtime, calls } = withAgentRun({ 'p1:m1': { kind: 'MOCK', behavior: ok('respuesta íntegra') } }, agentRun);

    const events: AgentEvent[] = [];
    const r = await runtime.run(agent([]), {
      message: 'hola',
      context: { source: 'CHAT' },
      onEvent: (e) => events.push(e),
    });

    // La ejecución del agente siguió y respondió igual, pese a que ambas escrituras de AgentRun fallaron.
    expect(r.text).toBe('respuesta íntegra');
    expect(calls).toHaveLength(1);
    expect(agentRun.create).toHaveBeenCalledTimes(1);
    expect(agentRun.update).toHaveBeenCalledTimes(1);
  });

  it('marca FAILED y guarda el mensaje de error cuando el proveedor falla sin respaldo', async () => {
    const updated: Record<string, unknown>[] = [];
    const agentRun: AgentRunSpy = {
      create: jest.fn(async () => undefined),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => void updated.push(data)),
    };
    const { runtime } = withAgentRun(
      { 'p1:m1': { kind: 'ANTHROPIC', behavior: fail(new Error('HTTP 500')) } },
      agentRun,
    );

    await expect(runtime.run(agent([]), { message: 'h', context: { source: 'CHAT' } })).rejects.toThrow('HTTP 500');
    expect(updated[0]).toMatchObject({ status: 'FAILED', error: 'HTTP 500' });
  });

  it('marca CANCELLED cuando el usuario cancela la ejecución', async () => {
    const controller = new AbortController();
    controller.abort();
    const updated: Record<string, unknown>[] = [];
    const agentRun: AgentRunSpy = {
      create: jest.fn(async () => undefined),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => void updated.push(data)),
    };
    const aborted = Object.assign(new Error('cancelado'), { name: 'AbortError' });
    const { runtime } = withAgentRun({ 'p1:m1': { kind: 'MOCK', behavior: fail(aborted) } }, agentRun);

    await expect(
      runtime.run(agent([]), { message: 'h', context: { source: 'CHAT' }, signal: controller.signal }),
    ).rejects.toThrow('cancelado');
    expect(updated[0]).toMatchObject({ status: 'CANCELLED' });
  });
});
