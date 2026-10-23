import type { ToolSpec } from '../llm/llm-provider';
import { AGENT_DRAFT_SCHEMA, CHANGE_PROPOSAL_SCHEMA } from './proposal.schema';

/** Herramientas internas del Copilot (ADR 0006 D1): lectura del workspace + creación de propuestas. */
export const COPILOT_TOOLS = {
  getAgent: 'get_agent',
  getAgentHealth: 'get_agent_health',
  listConnectors: 'list_connectors',
  listCatalog: 'list_catalog',
  listSkills: 'list_skills',
  listKnowledgeBases: 'list_knowledge_bases',
  getRecentFailures: 'get_recent_failures',
  searchProductDocs: 'search_product_docs',
  proposeAgent: 'propose_agent',
  proposeChanges: 'propose_changes',
} as const;

const agentIdInput = {
  type: 'object',
  properties: { agentId: { type: 'string', description: 'Id del agente; por defecto, el agente en foco.' } },
  additionalProperties: false,
};

/** Orden estable (favorece la caché de prompts). */
export const COPILOT_TOOL_SPECS: ToolSpec[] = [
  {
    name: COPILOT_TOOLS.getAgent,
    description:
      'Configuración del agente: perfil, modelo, herramientas, skills, conocimiento, ejemplos, casos de evaluación, rutinas, meta y estado de lanzamiento.',
    inputSchema: agentIdInput,
  },
  {
    name: COPILOT_TOOLS.getAgentHealth,
    description:
      'Puntaje de salud determinista del agente (0–100) con las verificaciones fallidas y sus recomendaciones.',
    inputSchema: agentIdInput,
  },
  {
    name: COPILOT_TOOLS.listConnectors,
    description:
      'Conectores instalados en el workspace con sus operaciones (id, nombre, descripción y si tienen efecto). Usa estos ids en las propuestas.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', maxLength: 100, description: 'Filtro opcional por nombre.' } },
      additionalProperties: false,
    },
  },
  {
    name: COPILOT_TOOLS.listCatalog,
    description:
      'Integraciones del catálogo de Nexo (instalables con un clic) con sus operaciones y si ya están instaladas.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['CRM', 'PROSPECCION', 'PRODUCTIVIDAD', 'MENSAJERIA', 'DATOS'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: COPILOT_TOOLS.listSkills,
    description: 'Skills existentes del workspace (id, nombre, descripción).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: COPILOT_TOOLS.listKnowledgeBases,
    description: 'Bases de conocimiento del workspace (id, nombre, descripción y número de documentos).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: COPILOT_TOOLS.getRecentFailures,
    description:
      'Fallos recientes del agente: feedback negativo, casos de evaluación fallidos, rutinas con error y errores de presupuesto.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Id del agente; por defecto, el agente en foco.' },
        days: { type: 'integer', minimum: 1, maximum: 90, description: 'Ventana en días (por defecto 30).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: COPILOT_TOOLS.searchProductDocs,
    description:
      'Busca en la guía oficial de Nexo (funciones, límites, buenas prácticas y preguntas frecuentes). Úsala antes de explicar cómo funciona la plataforma.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1, maxLength: 300 } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: COPILOT_TOOLS.proposeAgent,
    description:
      'Crea una propuesta de agente NUEVO para que el usuario la revise y aplique. No crea nada por sí misma. Requiere al menos 5 casos de evaluación y solo ids existentes.',
    inputSchema: AGENT_DRAFT_SCHEMA,
  },
  {
    name: COPILOT_TOOLS.proposeChanges,
    description:
      'Crea una propuesta de CAMBIOS sobre un agente existente para que el usuario la revise y aplique. No modifica nada por sí misma.',
    inputSchema: CHANGE_PROPOSAL_SCHEMA,
  },
];
