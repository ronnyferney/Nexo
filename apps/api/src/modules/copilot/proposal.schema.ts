import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import { isValidCron, isValidTimezone } from '../routines/cron.util';

/**
 * Payloads de las propuestas del Copilot (ADR 0006 D1) con JSON Schema estricto. Los mismos esquemas son el
 * `inputSchema` de las herramientas `propose_agent` y `propose_changes`, así el modelo ve exactamente lo que se valida.
 */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const MIN_EVAL_CASES = 5;
export const MAX_EXAMPLES = 20;

export interface DraftProfile {
  role: string;
  goals: string[];
  responsibilities?: string[];
  boundaries: string[];
  tone?: string;
  outputFormat?: string;
  language?: string;
}
export interface DraftOperation {
  operationId: string;
  requiresApproval: boolean;
  reason?: string;
}
export interface DraftIntegration {
  catalogId: string;
  reason?: string;
}
export type DraftSkill =
  { skillId: string } | { name: string; description: string; instructions: string; operationIds?: string[] };
export interface DraftExample {
  input: string;
  output: string;
}
export interface DraftEvalCase {
  input: string;
  expected?: string;
  criteria?: string;
  tags?: string[];
}
export interface DraftRoutine {
  name: string;
  prompt: string;
  schedule: string;
  timezone?: string;
}

export interface AgentDraft {
  summary: string;
  name: string;
  description?: string;
  profile: DraftProfile;
  systemPrompt?: string;
  provider: string;
  model: string;
  effort: (typeof EFFORTS)[number];
  targetScore?: number;
  operations?: DraftOperation[];
  integrations?: DraftIntegration[];
  skills?: DraftSkill[];
  knowledgeBaseIds?: string[];
  examples?: DraftExample[];
  evalCases: DraftEvalCase[];
  routines?: DraftRoutine[];
}

export interface AgentChanges {
  name?: string;
  description?: string;
  profile?: DraftProfile;
  systemPrompt?: string;
  provider?: string;
  model?: string;
  effort?: (typeof EFFORTS)[number];
  targetScore?: number;
  addOperations?: DraftOperation[];
  removeOperationIds?: string[];
  addSkills?: DraftSkill[];
  removeSkillIds?: string[];
  addKnowledgeBaseIds?: string[];
  removeKnowledgeBaseIds?: string[];
  examples?: DraftExample[];
  evalCases?: DraftEvalCase[];
  routines?: DraftRoutine[];
  integrations?: DraftIntegration[];
}

export interface ChangeProposal {
  agentId: string;
  summary: string;
  changes: AgentChanges;
}

const str = (maxLength: number, description?: string, minLength = 1) => ({
  type: 'string',
  minLength,
  maxLength,
  ...(description ? { description } : {}),
});
const strList = (maxItems: number, maxLength: number, description?: string) => ({
  type: 'array',
  maxItems,
  items: str(maxLength),
  ...(description ? { description } : {}),
});
const id = str(64);
const idList = (maxItems: number, description: string) => ({ type: 'array', maxItems, items: id, description });

const profileSchema = {
  type: 'object',
  description: 'Perfil estructurado del agente (ADR 0003).',
  additionalProperties: false,
  required: ['role', 'goals', 'boundaries'],
  properties: {
    role: str(1000, 'Quién es el agente y para quién trabaja (1–2 frases).'),
    goals: { ...strList(20, 500, 'Objetivos verificables (mínimo 2 recomendados).'), minItems: 1 },
    responsibilities: strList(30, 500, 'Tareas concretas que realiza.'),
    boundaries: { ...strList(30, 500, 'Lo que NO debe hacer (al menos uno).'), minItems: 1 },
    tone: str(300),
    outputFormat: str(1000),
    language: str(50),
  },
};

const operationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['operationId', 'requiresApproval'],
  properties: {
    operationId: { ...id, description: 'Id de una operación existente (list_connectors).' },
    requiresApproval: { type: 'boolean', description: 'true para toda operación con efecto (escritura/envío).' },
    reason: str(300),
  },
};

const integrationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['catalogId'],
  properties: {
    catalogId: { ...id, description: 'Id de una integración del catálogo (list_catalog) que aún no está instalada.' },
    reason: str(300),
  },
};

const skillSchema = {
  oneOf: [
    {
      type: 'object',
      description: 'Skill existente del workspace (list_skills).',
      additionalProperties: false,
      required: ['skillId'],
      properties: { skillId: id },
    },
    {
      type: 'object',
      description: 'Skill nueva con instrucciones completas.',
      additionalProperties: false,
      required: ['name', 'description', 'instructions'],
      properties: {
        name: str(80, undefined, 2),
        description: str(500, 'Cuándo usarla.'),
        instructions: str(20_000, 'Pasos en Markdown.'),
        operationIds: idList(30, 'Operaciones existentes que aporta la skill.'),
      },
    },
  ],
};

const exampleSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['input', 'output'],
  properties: { input: str(10_000), output: str(10_000) },
};

const evalCaseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['input'],
  anyOf: [
    { properties: { expected: { type: 'string' } }, required: ['expected'] },
    { properties: { criteria: { type: 'string' } }, required: ['criteria'] },
  ],
  properties: {
    input: str(10_000),
    expected: str(10_000, 'Respuesta de referencia.'),
    criteria: str(5_000, 'Rúbrica verificable.'),
    tags: strList(10, 40),
  },
};

const routineSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'prompt', 'schedule'],
  properties: {
    name: str(120),
    prompt: str(10_000, 'Instrucción autocontenida.'),
    schedule: str(120, 'Cron de 5 campos, p. ej. "0 8 * * 1-5".'),
    timezone: str(64, 'Zona horaria IANA (por defecto UTC).'),
  },
};

const modelFields = {
  provider: { ...id, description: 'Id del proveedor del catálogo del workspace (p. ej. "anthropic").' },
  model: str(128, 'Id del modelo del catálogo.'),
  effort: { type: 'string', enum: [...EFFORTS] },
  targetScore: { type: 'number', minimum: 0, maximum: 1 },
};

export const AGENT_DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'name', 'profile', 'provider', 'model', 'effort', 'evalCases'],
  properties: {
    summary: str(500, 'Resumen de la propuesta para el usuario.'),
    name: str(80, undefined, 2),
    description: str(500),
    profile: profileSchema,
    systemPrompt: str(8_000, 'Instrucciones adicionales breves (las políticas van en conocimiento).'),
    ...modelFields,
    operations: { type: 'array', maxItems: 30, items: operationSchema },
    integrations: { type: 'array', maxItems: 10, items: integrationSchema },
    skills: { type: 'array', maxItems: 10, items: skillSchema },
    knowledgeBaseIds: idList(20, 'Bases de conocimiento existentes (list_knowledge_bases).'),
    examples: { type: 'array', maxItems: MAX_EXAMPLES, items: exampleSchema },
    evalCases: { type: 'array', minItems: MIN_EVAL_CASES, maxItems: 50, items: evalCaseSchema },
    routines: { type: 'array', maxItems: 5, items: routineSchema },
  },
} as const;

export const CHANGE_PROPOSAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['agentId', 'summary', 'changes'],
  properties: {
    agentId: id,
    summary: str(500, 'Resumen de los cambios y su justificación.'),
    changes: {
      type: 'object',
      additionalProperties: false,
      minProperties: 1,
      dependencies: { provider: ['model'], model: ['provider'] },
      properties: {
        name: str(80, undefined, 2),
        description: str(500),
        profile: { ...profileSchema, description: 'Perfil completo nuevo (reemplaza al actual).' },
        systemPrompt: str(8_000, undefined, 0),
        ...modelFields,
        addOperations: { type: 'array', maxItems: 30, items: operationSchema },
        removeOperationIds: idList(30, 'Operaciones a desvincular.'),
        addSkills: { type: 'array', maxItems: 10, items: skillSchema },
        removeSkillIds: idList(20, 'Skills a quitar del agente (no se borran del workspace).'),
        addKnowledgeBaseIds: idList(20, 'Bases a asignar.'),
        removeKnowledgeBaseIds: idList(20, 'Bases a quitar.'),
        examples: { type: 'array', maxItems: MAX_EXAMPLES, items: exampleSchema },
        evalCases: { type: 'array', maxItems: 50, items: evalCaseSchema },
        routines: { type: 'array', maxItems: 5, items: routineSchema },
        integrations: { type: 'array', maxItems: 10, items: integrationSchema },
      },
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: true });
const draftValidator: ValidateFunction<AgentDraft> = ajv.compile(AGENT_DRAFT_SCHEMA);
const changeValidator: ValidateFunction<ChangeProposal> = ajv.compile(CHANGE_PROPOSAL_SCHEMA);

function format(errors: ErrorObject[] | null | undefined): string[] {
  // `oneOf`/`anyOf` generan un error por rama; se dejan solo los más específicos y sin duplicados.
  const list = (errors ?? []).map((e) => {
    const extra =
      e.keyword === 'additionalProperties'
        ? ` (${(e.params as { additionalProperty: string }).additionalProperty})`
        : e.keyword === 'enum'
          ? ` (${(e.params as { allowedValues: unknown[] }).allowedValues.join(', ')})`
          : '';
    return `${e.instancePath || '(raíz)'}: ${e.message ?? 'inválido'}${extra}`;
  });
  return [...new Set(list)].slice(0, 20);
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** Valores semánticos que no expresa el esquema (cron y zona horaria de las rutinas). */
function routineErrors(routines: DraftRoutine[] | undefined, path: string): string[] {
  return (routines ?? []).flatMap((r, i) => [
    ...(isValidCron(r.schedule) ? [] : [`${path}/${i}/schedule: expresión cron inválida "${r.schedule}"`]),
    ...(r.timezone && !isValidTimezone(r.timezone) ? [`${path}/${i}/timezone: zona horaria inválida`] : []),
  ]);
}

export function validateAgentDraft(value: unknown): ValidationResult<AgentDraft> {
  if (!draftValidator(value)) return { ok: false, errors: format(draftValidator.errors) };
  const draft = value;
  const errors = routineErrors(draft.routines, '/routines');
  return errors.length ? { ok: false, errors } : { ok: true, value: draft };
}

export function validateChangeProposal(value: unknown): ValidationResult<ChangeProposal> {
  if (!changeValidator(value)) return { ok: false, errors: format(changeValidator.errors) };
  const proposal = value;
  const errors = routineErrors(proposal.changes.routines, '/changes/routines');
  return errors.length ? { ok: false, errors } : { ok: true, value: proposal };
}

/** Recursos existentes del workspace contra los que se verifican las referencias de una propuesta. */
export interface WorkspaceRefs {
  /** `"<providerId>:<modelId>"` disponibles en el catálogo del workspace. */
  models: Set<string>;
  operationIds: Set<string>;
  skillIds: Set<string>;
  knowledgeBaseIds: Set<string>;
  catalogIds: Set<string>;
}

export const isNewSkill = (s: DraftSkill): s is Exclude<DraftSkill, { skillId: string }> => !('skillId' in s);

interface RefSource {
  provider?: string;
  model?: string;
  operations?: DraftOperation[];
  skills?: DraftSkill[];
  knowledgeBaseIds?: string[];
  integrations?: DraftIntegration[];
}

/** Referencias inexistentes (ids inventados, modelos fuera del catálogo): errores que el modelo debe corregir. */
export function referenceErrors(src: RefSource, refs: WorkspaceRefs): string[] {
  const errors: string[] = [];
  if (src.provider && src.model && !refs.models.has(`${src.provider}:${src.model}`)) {
    const options = [...refs.models].slice(0, 15).join(', ');
    errors.push(`El modelo "${src.provider}:${src.model}" no está disponible en el catálogo. Opciones: ${options}`);
  }
  for (const op of src.operations ?? []) {
    if (!refs.operationIds.has(op.operationId)) errors.push(`Operación inexistente: ${op.operationId}`);
  }
  for (const skill of src.skills ?? []) {
    if (!isNewSkill(skill)) {
      if (!refs.skillIds.has(skill.skillId)) errors.push(`Skill inexistente: ${skill.skillId}`);
    } else {
      for (const opId of skill.operationIds ?? []) {
        if (!refs.operationIds.has(opId)) errors.push(`Operación inexistente en la skill "${skill.name}": ${opId}`);
      }
    }
  }
  for (const kb of src.knowledgeBaseIds ?? []) {
    if (!refs.knowledgeBaseIds.has(kb)) errors.push(`Base de conocimiento inexistente: ${kb}`);
  }
  for (const integration of src.integrations ?? []) {
    if (!refs.catalogIds.has(integration.catalogId)) {
      errors.push(`Integración inexistente en el catálogo: ${integration.catalogId}`);
    }
  }
  return errors;
}

/** Referencias de una propuesta de cambios en el formato de `referenceErrors`. */
export function changeRefs(c: AgentChanges): RefSource {
  return {
    provider: c.provider,
    model: c.model,
    operations: c.addOperations,
    skills: c.addSkills,
    knowledgeBaseIds: c.addKnowledgeBaseIds,
    integrations: c.integrations,
  };
}
