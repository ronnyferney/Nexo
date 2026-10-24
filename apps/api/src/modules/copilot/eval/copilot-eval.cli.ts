import type { HttpClientService } from '../../../common/http/http-client.service';
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { copilotModelFrom } from '../../../config/configuration';
import { AnthropicDriver } from '../../llm/drivers/anthropic.driver';
import { MockDriver } from '../../llm/drivers/mock.driver';
import { SYSTEM_ANTHROPIC_MODELS, SYSTEM_MOCK_MODELS } from '../../llm/pricing';
import { COPILOT_VERSION } from '../definition/copilot.definition';
import { loadEvalCases, runEvalSuite } from './copilot-eval';

/**
 * `npm run copilot:eval [filtro]`: ejecuta el conjunto de evaluación del Copilot con el modelo configurado
 * (`COPILOT_PROVIDER`/`COPILOT_MODEL`; sin `ANTHROPIC_API_KEY` usa mock) e informa el puntaje. Sale con código 1 si el
 * puntaje queda bajo `COPILOT_EVAL_MIN_SCORE` (por defecto 0.9).
 */
async function main() {
  // Mismas variables que la API (apps/api/.env); las del entorno tienen prioridad.
  if (existsSync('.env')) process.loadEnvFile('.env');
  const { provider, model } = copilotModelFrom(process.env);
  const isMock = provider === 'mock';
  if (!isMock && provider !== 'anthropic') {
    throw new Error(`COPILOT_PROVIDER no soportado por el evaluador: ${provider} (use anthropic o mock)`);
  }
  const models = isMock ? SYSTEM_MOCK_MODELS : SYSTEM_ANTHROPIC_MODELS;
  const pricing = models.find((m) => m.id === model);
  if (!pricing) throw new Error(`Modelo no disponible en ${provider}: ${model}`);
  const client = isMock
    ? new MockDriver().create()
    : // Herramienta local del operador contra la API oficial de Anthropic (host fijo): fetch estándar de Node.
      new AnthropicDriver({ safeFetch: () => globalThis.fetch } as unknown as HttpClientService).create({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

  const filter = process.argv[2];
  const cases = loadEvalCases().filter((c) => !filter || c.id.includes(filter));
  if (!cases.length) throw new Error('No se encontraron casos de evaluación del Copilot');

  console.log(`Nexo Copilot ${COPILOT_VERSION} · ${provider}:${model} · ${cases.length} caso(s)\n`);
  const suite = await runEvalSuite(cases, {
    client,
    model,
    pricing,
    catalogModels: models.map((m) => `${provider}:${m.id}`),
  });
  for (const r of suite.cases) {
    console.log(`${r.passed ? 'OK ' : 'FALLA'} ${r.id} — ${(r.score * 100).toFixed(0)}%`);
    if (r.error) console.log(`      error: ${r.error}`);
    for (const c of r.checks.filter((x) => !x.passed)) {
      console.log(`      ✗ ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
    }
  }
  const min = Number(process.env.COPILOT_EVAL_MIN_SCORE ?? 0.9);
  console.log(
    `\nPuntaje: ${(suite.score * 100).toFixed(1)}% · casos aprobados ${suite.passedCases}/${suite.total} · costo estimado $${suite.costUsd.toFixed(4)} · mínimo ${(min * 100).toFixed(0)}%`,
  );
  if (suite.score < min) process.exitCode = 1;
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exitCode = 1;
});
