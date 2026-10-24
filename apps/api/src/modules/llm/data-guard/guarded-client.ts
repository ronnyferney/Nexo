import { UnprocessableEntityException } from '@nestjs/common';
import type { AgentEvent, LlmClient, LlmRunRequest, LlmRunResult, ToolOutcome } from '../llm-provider';
import type { DataCategory } from './detector';
import { describeCategories, MaskSession, StreamUnmasker, totalOf, type CategoryCounts } from './mask-session';

/** El mensaje del usuario contiene datos personales y la política del workspace es `block` (no se llama al modelo). */
export class DataBlockedException extends UnprocessableEntityException {
  constructor(readonly categories: DataCategory[]) {
    super(
      `Su mensaje contiene datos personales (${describeCategories(categories)}) y la política de protección de datos ` +
        'del workspace impide enviarlos al modelo de IA. Retírelos e intente de nuevo.',
    );
    this.name = 'DataBlockedException';
  }
}

export const blockedToolOutput = (categories: DataCategory[]) =>
  `BLOQUEADO POR PROTECCIÓN DE DATOS: el resultado de la herramienta contenía datos personales ` +
  `(${describeCategories(categories)}) y la política del workspace impide enviarlos al modelo. ` +
  'Informe al usuario que no puede mostrar esa información.';

function maskNotice(counts: CategoryCounts, where: string): string | null {
  const credentials = counts.CREDENTIAL ?? 0;
  const personal: CategoryCounts = { ...counts };
  delete personal.CREDENTIAL;
  const parts: string[] = [];
  const n = totalOf(personal);
  if (n) {
    parts.push(
      `se ${n === 1 ? 'enmascaró 1 dato personal' : `enmascararon ${n} datos personales`} (${describeCategories(personal)})`,
    );
  }
  if (credentials) {
    parts.push(`se ${credentials === 1 ? 'ocultó 1 credencial' : `ocultaron ${credentials} credenciales`}`);
  }
  return parts.length ? `Protección de datos: ${parts.join(' y ')} ${where} antes de enviarlo al modelo.` : null;
}

/**
 * Ejecuta `inner.run` con DataGuard (ADR 0008 D1-D2) aplicado a todo lo que sale hacia el proveedor:
 * - historial (enmascarado determinista), mensaje del usuario y resultados de herramientas → marcadores;
 * - system prompt y descripciones de herramientas → solo se ocultan credenciales;
 * - entradas de herramientas, eventos y respuesta → se restituyen los valores antes de ejecutar o mostrar;
 * - el historial que se devuelve para guardar conserva el formato nativo: el prefijo previo tal cual (append-only)
 *   y lo nuevo con los valores restituidos (los bloques de razonamiento quedan intactos).
 */
export async function runGuarded(inner: LlmClient, req: LlmRunRequest, s: MaskSession): Promise<LlmRunResult> {
  const priorHistory = req.history ?? [];
  const history = s.maskHistory(priorHistory, [req.userMessage]);

  if (s.mode === 'block') {
    const found = s.personal(req.userMessage);
    if (found.length) throw new DataBlockedException(found.map((f) => f.category));
  }
  const user = s.mask(req.userMessage);

  const emit = (e: AgentEvent) => req.onEvent?.(e);
  const text = new StreamUnmasker(
    (t) => s.unmaskText(t),
    (t) => emit({ type: 'text', text: t }),
  );
  const notice = (counts: CategoryCounts, where: string) => {
    const message = maskNotice(counts, where);
    if (message) {
      text.flush();
      emit({ type: 'notice', message });
    }
  };
  notice(user.counts, 'en su mensaje');

  const onEvent = req.onEvent
    ? (e: AgentEvent) => {
        if (e.type === 'text') return text.push(e.text);
        text.flush();
        if (e.type === 'tool_call') emit({ ...e, input: s.unmaskDeep(e.input) });
        else if (e.type === 'tool_result') emit({ ...e, output: s.unmaskText(e.output) });
        else emit(e);
      }
    : undefined;

  const result = await inner.run({
    ...req,
    system: s.redactCredentials(req.system),
    tools: req.tools.map((t) => ({ ...t, description: s.redactCredentials(t.description) })),
    history,
    userMessage: user.text,
    onEvent,
    executeTool: async (call): Promise<ToolOutcome> => {
      const outcome = await req.executeTool({ ...call, input: s.unmaskDeep(call.input) });
      if (s.mode === 'block') {
        const found = s.personal(outcome.content);
        if (found.length) return { content: blockedToolOutput(found.map((f) => f.category)), isError: true };
      }
      const masked = s.mask(outcome.content);
      notice(masked.counts, 'en el resultado de una herramienta');
      return { ...outcome, content: masked.text };
    },
  });
  text.flush();

  const produced = Array.isArray(result.history) ? result.history : [];
  // Los drivers devuelven `history enviado + turnos nuevos`; si no, se guarda todo restituido.
  const appended = produced.length >= history.length ? produced.slice(history.length) : produced;
  const base = produced.length >= history.length ? priorHistory : [];
  return {
    ...result,
    text: s.unmaskText(result.text),
    history: [...base, ...s.unmaskHistory(appended)],
  };
}

/** Cliente que aplica DataGuard en cada `run`; `open` crea la sesión de enmascarado de esa ejecución. */
export function guardClient(inner: LlmClient, open: (scope?: string) => Promise<MaskSession>): LlmClient {
  const guarded: LlmClient = {
    run: async (req) => runGuarded(inner, req, await open(req.privacyScope)),
    test: () => inner.test(),
  };
  if (inner.verify) guarded.verify = () => inner.verify!();
  if (inner.listModels) guarded.listModels = () => inner.listModels!();
  return guarded;
}
