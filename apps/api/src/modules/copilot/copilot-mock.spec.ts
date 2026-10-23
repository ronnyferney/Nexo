import { MockDriver } from '../llm/drivers/mock.driver';
import type { LlmRunRequest, ToolCall } from '../llm/llm-provider';
import { COPILOT_TOOL_SPECS } from './copilot-tools.definitions';
import { buildCopilotSystem } from './definition/copilot.definition';

function request(message: string, over: Partial<LlmRunRequest> = {}) {
  const calls: ToolCall[] = [];
  const req: LlmRunRequest = {
    model: 'mock-echo',
    system: buildCopilotSystem({ mode: 'CREATE' }),
    effort: 'medium',
    history: [],
    userMessage: message,
    tools: COPILOT_TOOL_SPECS,
    maxTurns: 12,
    executeTool: async (call) => {
      calls.push(call);
      return { content: `ok ${call.name}` };
    },
    ...over,
  };
  return { req, calls };
}

const client = new MockDriver().create();

describe('MockDriver con [NEXO_COPILOT]', () => {
  it('"crea" invoca propose_agent con un borrador', async () => {
    const { req, calls } = request('Crea un agente de soporte de envíos');
    const r = await client.run(req);
    expect(calls.map((c) => c.name)).toEqual(['propose_agent']);
    expect((calls[0].input as { evalCases: unknown[] }).evalCases).toHaveLength(5);
    expect(r.text).toContain('Aplicar');
  });

  it('"diagnostica" invoca get_recent_failures con el agente en foco', async () => {
    const { req, calls } = request('Diagnostica por qué falla', {
      system: buildCopilotSystem({ mode: 'DIAGNOSE', agentId: 'ag_9' }),
    });
    await client.run(req);
    expect(calls).toEqual([expect.objectContaining({ name: 'get_recent_failures', input: { agentId: 'ag_9' } })]);
  });

  it('"mejora" con agente en foco invoca propose_changes', async () => {
    const { req, calls } = request('Mejora este agente', {
      system: buildCopilotSystem({ mode: 'IMPROVE', agentId: 'ag_1' }),
    });
    await client.run(req);
    expect(calls[0].name).toBe('propose_changes');
    expect(calls[0].input).toMatchObject({ agentId: 'ag_1' });
  });

  it('pregunta sobre el producto → search_product_docs', async () => {
    const { req, calls } = request('¿Qué es Nexo Edge?');
    await client.run(req);
    expect(calls[0]).toMatchObject({ name: 'search_product_docs', input: { query: '¿Qué es Nexo Edge?' } });
  });

  it('en otro caso entrevista: una pregunta a la vez, máximo 5', async () => {
    const first = await client.run(request('Necesito un agente para mi equipo').req);
    expect(first.text).toMatch(/\?/);
    let history = first.history;
    const seen = new Set([first.text]);
    for (let i = 0; i < 4; i++) {
      const r = await client.run(request('Respuesta del usuario', { history }).req);
      expect(seen.has(r.text)).toBe(false);
      seen.add(r.text);
      history = r.history;
    }
    const done = await client.run(request('Algo más', { history }).req);
    expect(done.text).toContain('crea el agente');
  });

  it('responde en inglés si el usuario escribe en inglés', async () => {
    const r = await client.run(request('I need an agent for my sales team').req);
    expect(r.text).toMatch(/What problem/);
  });

  it('conserva el eco y /tool sin el marcador', async () => {
    const echo = await client.run(request('hola', { system: 'Agente normal', tools: [] }).req);
    expect(echo.text).toBe('Eco: hola\n(tools disponibles: ninguna)');
    const { req, calls } = request('/tool get_agent {"agentId":"x"}');
    const r = await client.run(req);
    expect(calls[0]).toMatchObject({ name: 'get_agent', input: { agentId: 'x' } });
    expect(r.text).toBe('Resultado de get_agent: ok get_agent');
  });
});
