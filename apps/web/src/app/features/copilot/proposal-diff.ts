import type { Agent } from '../../core/models';
import type { CopilotProposal } from '../../core/copilot.models';

/** Sección legible de una propuesta: texto actual frente al propuesto, para `nx-diff`. */
export interface ProposalSection {
  key: string;
  label: string;
  before: string;
  after: string;
}

/** Orden y etiquetas de los campos conocidos de la propuesta (ADR 0006 D1). */
const FIELDS: { key: string; label: string; aliases?: string[] }[] = [
  { key: 'name', label: 'Nombre' },
  { key: 'description', label: 'Descripción' },
  { key: 'profile', label: 'Perfil' },
  { key: 'systemPrompt', label: 'Instrucciones adicionales' },
  { key: 'model', label: 'Modelo', aliases: ['provider', 'effort'] },
  { key: 'fallbackModels', label: 'Modelos de respaldo' },
  { key: 'tools', label: 'Herramientas', aliases: ['operations', 'operationIds'] },
  { key: 'addOperations', label: 'Herramientas a agregar' },
  { key: 'removeOperationIds', label: 'Herramientas a quitar' },
  { key: 'addSkills', label: 'Skills a agregar' },
  { key: 'removeSkillIds', label: 'Skills a quitar' },
  { key: 'addKnowledgeBaseIds', label: 'Bases de conocimiento a agregar' },
  { key: 'removeKnowledgeBaseIds', label: 'Bases de conocimiento a quitar' },
  { key: 'integrations', label: 'Integraciones del catálogo a instalar', aliases: ['catalogIntegrations'] },
  { key: 'skills', label: 'Skills' },
  { key: 'knowledgeBases', label: 'Bases de conocimiento', aliases: ['knowledgeBaseIds'] },
  { key: 'examples', label: 'Ejemplos' },
  { key: 'evalCases', label: 'Casos de evaluación' },
  { key: 'routines', label: 'Rutinas sugeridas' },
  { key: 'targetScore', label: 'Meta de calidad' },
];

const PROFILE_LABELS: [string, string][] = [
  ['role', 'Rol'],
  ['goals', 'Objetivos'],
  ['responsibilities', 'Responsabilidades'],
  ['boundaries', 'Límites'],
  ['tone', 'Tono'],
  ['outputFormat', 'Formato de respuesta'],
  ['language', 'Idioma'],
];

const EFFORT_LABELS: Record<string, string> = { low: 'bajo', medium: 'medio', high: 'alto', xhigh: 'muy alto', max: 'máximo' };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

/** Cambios dentro del payload: admite `{ changes }`, `{ agent }` o los campos en la raíz. */
function changesOf(payload: Rec): Rec {
  if (isRec(payload['changes'])) return payload['changes'];
  if (isRec(payload['agent'])) return { ...payload, ...payload['agent'] };
  return payload;
}

/** Texto de un elemento de lista: usa el campo más descriptivo disponible. */
function itemText(v: unknown): string {
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (!isRec(v)) return JSON.stringify(v);
  if (typeof v['input'] === 'string') {
    const exp = v['expected'] ?? v['output'] ?? v['expectedOutput'];
    return exp ? `${v['input']} → ${String(exp)}` : String(v['input']);
  }
  const name = v['toolName'] ?? v['name'] ?? v['label'] ?? v['title'] ?? v['key'] ?? v['catalogId'] ?? v['skillId'] ?? v['operationId'] ?? v['id'];
  const extra: string[] = [];
  if (v['requiresApproval'] === true) extra.push('requiere aprobación');
  if (typeof v['schedule'] === 'string') extra.push(v['schedule']);
  if (typeof v['cron'] === 'string') extra.push(v['cron']);
  if (typeof v['reason'] === 'string') extra.push(v['reason']);
  if (v['isNew'] === true || (typeof v['instructions'] === 'string' && !v['id'])) extra.push('nueva');
  const desc = typeof v['description'] === 'string' ? `: ${v['description']}` : '';
  return `${String(name ?? 'Elemento')}${desc}${extra.length ? ` (${extra.join(', ')})` : ''}`;
}

function listText(v: unknown): string {
  if (!Array.isArray(v)) return valueText(v);
  return v.map((x) => `- ${itemText(x)}`).join('\n');
}

function profileText(p: unknown): string {
  if (!isRec(p)) return valueText(p);
  const out: string[] = [];
  for (const [k, label] of PROFILE_LABELS) {
    const v = p[k];
    if (Array.isArray(v)) {
      if (v.length) out.push(`${label}:`, ...v.map((x) => `- ${String(x)}`));
    } else if (typeof v === 'string' && v.trim()) out.push(`${label}: ${v.trim()}`);
  }
  return out.join('\n');
}

function valueText(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return listText(v);
  return JSON.stringify(v, null, 2);
}

function modelText(src: Rec): string {
  const parts: string[] = [];
  if (src['provider']) parts.push(`Proveedor: ${String(src['provider'])}`);
  if (src['model']) parts.push(`Modelo: ${String(src['model'])}`);
  if (src['effort']) parts.push(`Esfuerzo: ${EFFORT_LABELS[String(src['effort'])] ?? String(src['effort'])}`);
  return parts.join('\n');
}

function fieldText(key: string, src: Rec): string {
  switch (key) {
    case 'profile':
      return profileText(src['profile']);
    case 'model':
      return modelText(src);
    case 'tools':
      return listText(src['tools'] ?? src['operations'] ?? src['operationIds']);
    case 'addSkills':
      return listText(src['addSkills']);
    case 'integrations':
      return listText(src['integrations'] ?? src['catalogIntegrations']);
    case 'knowledgeBases':
      return listText(src['knowledgeBases'] ?? src['knowledgeBaseIds']);
    case 'targetScore':
      return typeof src['targetScore'] === 'number' ? `${Math.round(src['targetScore'] * 100)} %` : '';
    default:
      return valueText(src[key]);
  }
}

/** Configuración actual del agente en el mismo formato que la propuesta. */
function agentSource(a: Agent | null | undefined): Rec {
  if (!a) return {};
  return {
    name: a.name,
    description: a.description ?? '',
    profile: a.profile ?? {},
    systemPrompt: a.systemPrompt,
    provider: a.provider,
    model: a.model,
    effort: a.effort,
    fallbackModels: a.fallbackModels ?? [],
    tools: (a.tools ?? []).map((t) => ({ toolName: t.toolName, requiresApproval: t.requiresApproval })),
    skills: (a.skills ?? []).map((s) => s.name),
    knowledgeBases: (a.knowledgeBases ?? []).map((k) => k.name),
    targetScore: a.targetScore,
  };
}

/** Campos que la propuesta agrega (no reemplazan nada del agente actual). */
const ADDITIVE = new Set(['integrations', 'examples', 'evalCases', 'routines', 'addOperations', 'addSkills', 'addKnowledgeBaseIds']);
/** Campos que quitan elementos: se muestran como líneas eliminadas, con el nombre actual si se conoce. */
const REMOVALS = new Set(['removeOperationIds', 'removeSkillIds', 'removeKnowledgeBaseIds']);

function removalText(key: string, ids: unknown, agent: Agent | null | undefined): string {
  if (!Array.isArray(ids)) return valueText(ids);
  const names = new Map<string, string>();
  for (const t of agent?.tools ?? []) names.set(t.operationId, t.toolName);
  for (const s of agent?.skills ?? []) names.set(s.id, s.name);
  for (const k of agent?.knowledgeBases ?? []) names.set(k.id, k.name);
  void key;
  return ids.map((id) => `- ${names.get(String(id)) ?? String(id)}`).join('\n');
}

/**
 * Convierte una propuesta en secciones legibles con su texto anterior y propuesto.
 * Para `CREATE_AGENT` el texto anterior está vacío; para `UPDATE_AGENT` se compara con el agente actual.
 */
export function proposalSections(p: CopilotProposal, agent?: Agent | null): ProposalSection[] {
  const changes = changesOf(p.payload ?? {});
  const current = p.kind === 'UPDATE_AGENT' ? agentSource(agent) : {};
  const sections: ProposalSection[] = [];
  const known = new Set<string>(['changes', 'agent', 'agentId', 'summary', 'kind']);
  for (const f of FIELDS) {
    const keys = [f.key, ...(f.aliases ?? [])];
    keys.forEach((k) => known.add(k));
    if (!keys.some((k) => changes[k] !== undefined)) continue;
    if (REMOVALS.has(f.key)) {
      sections.push({ key: f.key, label: f.label, before: removalText(f.key, changes[f.key], agent), after: '' });
      continue;
    }
    const after = fieldText(f.key, changes);
    const before = ADDITIVE.has(f.key) ? '' : fieldText(f.key, current);
    if (before === after && p.kind === 'UPDATE_AGENT') continue;
    sections.push({ key: f.key, label: f.label, before, after });
  }
  // Campos no previstos: se muestran tal cual para no ocultar nada al usuario.
  for (const [k, v] of Object.entries(changes)) {
    if (known.has(k) || v === undefined) continue;
    sections.push({ key: k, label: k, before: '', after: valueText(v) });
  }
  return sections;
}
