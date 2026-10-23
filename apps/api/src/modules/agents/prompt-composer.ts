/**
 * Composición del system prompt de un agente (ADR 0003, D2). Función pura y determinista: con las mismas entradas
 * produce exactamente el mismo texto, en un orden de secciones fijo, lo que favorece la caché de prompts del
 * proveedor. Las secciones vacías se omiten; un perfil vacío sin habilidades, conocimiento ni ejemplos devuelve
 * exactamente `systemPrompt` (compatibilidad con agentes anteriores al ADR 0003).
 */

/** Perfil estructurado del agente (`Agent.profile`). Todos los campos son opcionales. */
export interface AgentProfile {
  role?: string;
  goals?: string[];
  responsibilities?: string[];
  boundaries?: string[];
  tone?: string;
  outputFormat?: string;
  language?: string;
}

export interface PromptSkill {
  name: string;
  slug: string;
  description: string;
}

export interface PromptKnowledgeBase {
  name: string;
  description?: string | null;
}

export interface PromptExample {
  input: string;
  output: string;
}

export interface ComposeSystemPromptInput {
  systemPrompt?: string | null;
  profile?: AgentProfile | null;
  skills?: PromptSkill[];
  knowledgeBases?: PromptKnowledgeBase[];
  examples?: PromptExample[];
}

export const LOAD_SKILL_TOOL = 'load_skill';
export const SEARCH_KNOWLEDGE_TOOL = 'search_knowledge';

const clean = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');
const cleanList = (items: unknown): string[] => (Array.isArray(items) ? items.map(clean).filter(Boolean) : []);
const bullets = (items: string[]) => items.map((i) => `- ${i}`).join('\n');
const section = (title: string, body: string) => `## ${title}\n${body}`;

/** Normaliza un valor JSON arbitrario (p. ej. `Agent.profile`) a un perfil con solo campos válidos y no vacíos. */
export function normalizeProfile(value: unknown): AgentProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const v = value as Record<string, unknown>;
  const out: AgentProfile = {};
  for (const key of ['role', 'tone', 'outputFormat', 'language'] as const) {
    const s = clean(v[key]);
    if (s) out[key] = s;
  }
  for (const key of ['goals', 'responsibilities', 'boundaries'] as const) {
    const list = cleanList(v[key]);
    if (list.length) out[key] = list;
  }
  return out;
}

/** "No debes…": cada límite se expresa como prohibición explícita. */
function boundary(text: string): string {
  if (/^no\s/i.test(text)) return text;
  return `No debes ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

export function composeSystemPrompt(input: ComposeSystemPromptInput): string {
  const systemPrompt = input.systemPrompt ?? '';
  const profile = normalizeProfile(input.profile);
  const skills = [...(input.skills ?? [])].sort((a, b) => a.slug.localeCompare(b.slug));
  const bases = [...(input.knowledgeBases ?? [])]
    .map((k) => ({ name: clean(k.name), description: clean(k.description) }))
    .filter((k) => k.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  const examples = (input.examples ?? [])
    .map((e) => ({ input: clean(e.input), output: clean(e.output) }))
    .filter((e) => e.input && e.output);

  const sections: string[] = [];
  if (profile.role) sections.push(section('Rol', profile.role));
  if (profile.goals) sections.push(section('Objetivos', bullets(profile.goals)));
  if (profile.responsibilities) sections.push(section('Responsabilidades', bullets(profile.responsibilities)));
  if (profile.boundaries) {
    sections.push(section('Límites', `Lo que NO debes hacer:\n${bullets(profile.boundaries.map(boundary))}`));
  }
  const style = [
    profile.tone ? `Tono: ${profile.tone}` : '',
    profile.outputFormat ? `Formato de salida: ${profile.outputFormat}` : '',
  ].filter(Boolean);
  if (style.length) sections.push(section('Tono y formato', style.join('\n')));
  if (profile.language) sections.push(section('Idioma', `Responde siempre en ${profile.language}.`));

  const extras: string[] = [];
  if (skills.length) {
    extras.push(
      section(
        'Habilidades disponibles',
        [
          `Antes de realizar una tarea que corresponda a una de estas habilidades, carga sus instrucciones completas con la herramienta \`${LOAD_SKILL_TOOL}\` indicando su identificador, y síguelas.`,
          bullets(skills.map((s) => `**${clean(s.name)}** (\`${s.slug}\`): ${clean(s.description)}`)),
        ].join('\n'),
      ),
    );
  }
  if (bases.length) {
    extras.push(
      section(
        'Conocimiento',
        [
          `Tienes acceso a la base de conocimiento de la empresa. Antes de responder sobre temas de la empresa (productos, servicios, políticas, procesos o datos internos), usa la herramienta \`${SEARCH_KNOWLEDGE_TOOL}\` y basa tu respuesta en los fragmentos encontrados, citando el documento. Si no encuentras información, dilo en lugar de inventarla.`,
          'Bases disponibles:',
          bullets(bases.map((b) => (b.description ? `${b.name}: ${b.description}` : b.name))),
        ].join('\n'),
      ),
    );
  }
  if (examples.length) {
    extras.push(
      section(
        'Ejemplos',
        [
          'Ejemplos de entradas y de la respuesta esperada; úsalos como guía de estilo y criterio, no los repitas literalmente.',
          ...examples.map((e, i) => `### Ejemplo ${i + 1}\nEntrada:\n${e.input}\n\nSalida esperada:\n${e.output}`),
        ].join('\n\n'),
      ),
    );
  }

  if (!sections.length && !extras.length) return systemPrompt;
  const instructions = systemPrompt.trim();
  if (instructions) sections.push(section('Instrucciones adicionales', instructions));
  return [...sections, ...extras].join('\n\n');
}
