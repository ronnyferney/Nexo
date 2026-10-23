import type { WorkflowEdge, WorkflowNode } from '../../core/models';

/**
 * Plantillas locales de flujos (ADR 0003 D6.7). Los nodos que necesitan una operación de conector, un agente
 * o un sub-flujo quedan sin seleccionar para que el usuario los elija en el constructor.
 */
export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** Pasos que el usuario debe completar después de crear el flujo. */
  todo: string[];
  schedule?: string;
  definition: { nodes: WorkflowNode[]; edges: WorkflowEdge[] };
}

const node = (id: string, type: WorkflowNode['type'], name: string, x: number, y: number, config: Record<string, unknown> = {}): WorkflowNode => ({
  id,
  type,
  name,
  position: { x, y },
  config,
});

const edge = (source: string, target: string, sourceHandle?: string): WorkflowEdge => ({
  id: `e_${source}_${target}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
});

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'webhook-crm',
    name: 'Webhook → CRM → respuesta',
    description: 'Recibe un webhook, consulta un registro en su CRM y responde con los datos.',
    icon: 'plug',
    todo: ['Elegir la operación del CRM en el nodo «Consultar CRM»', 'Activar el flujo para habilitar el webhook'],
    definition: {
      nodes: [
        node('trigger', 'trigger', 'Webhook', 80, 160),
        node('crm', 'connector', 'Consultar CRM', 360, 160, { operationId: '', input: { id: '{{ input.id }}' }, retries: 1 }),
        node('respuesta', 'output', 'Respuesta', 640, 160, { output: { ok: true, cliente: '{{ nodes.crm.output.data }}' } }),
      ],
      edges: [edge('trigger', 'crm'), edge('crm', 'respuesta')],
    },
  },
  {
    id: 'classify-route',
    name: 'Clasificar con agente IA y enrutar',
    description: 'Un agente clasifica el mensaje en JSON y una condición lo envía por la rama urgente o la normal.',
    icon: 'branch',
    todo: ['Elegir el agente clasificador', 'Elegir la operación para crear el ticket urgente'],
    definition: {
      nodes: [
        node('trigger', 'trigger', 'Mensaje entrante', 80, 200),
        node('clasificar', 'agent', 'Clasificar', 360, 200, {
          agentId: '',
          message:
            'Clasifica el siguiente mensaje. Responde solo JSON con la forma {"categoria": "urgente" | "normal", "motivo": "..."}.\n\nMensaje: {{ input.mensaje }}',
          parseJson: true,
        }),
        node('es_urgente', 'condition', '¿Es urgente?', 640, 200, {
          combinator: 'and',
          rules: [{ left: '{{ nodes.clasificar.output.json.categoria }}', operator: 'eq', right: 'urgente' }],
        }),
        node('ticket', 'connector', 'Crear ticket urgente', 920, 100, {
          operationId: '',
          input: { titulo: '{{ input.mensaje }}', motivo: '{{ nodes.clasificar.output.json.motivo }}' },
          retries: 1,
        }),
        node('normal', 'transform', 'Respuesta estándar', 920, 300, {
          output: { estado: 'recibido', categoria: '{{ nodes.clasificar.output.json.categoria }}' },
        }),
      ],
      edges: [edge('trigger', 'clasificar'), edge('clasificar', 'es_urgente'), edge('es_urgente', 'ticket', 'true'), edge('es_urgente', 'normal', 'false')],
    },
  },
  {
    id: 'loop-list',
    name: 'Procesar lista con bucle',
    description: 'Recorre los elementos de la entrada y ejecuta un sub-flujo por cada uno (3 en paralelo).',
    icon: 'repeat',
    todo: ['Crear o elegir el sub-flujo que procesa un elemento (recibe { item, index })'],
    definition: {
      nodes: [
        node('trigger', 'trigger', 'Inicio', 80, 160),
        node('bucle', 'loop', 'Por cada elemento', 360, 160, { items: '{{ input.items }}', workflowId: '', concurrency: 3 }),
        node('respuesta', 'output', 'Resumen', 640, 160, {
          output: { procesados: '{{ nodes.bucle.output.count }}', resultados: '{{ nodes.bucle.output.results }}' },
        }),
      ],
      edges: [edge('trigger', 'bucle'), edge('bucle', 'respuesta')],
    },
  },
  {
    id: 'error-notify',
    name: 'Notificación de errores',
    description: 'Para usar como flujo de error: arma un mensaje con el flujo, la ejecución y el error, y lo envía.',
    icon: 'bell',
    todo: ['Elegir la operación de notificación (correo, chat, webhook…)', 'Asignarlo como «Flujo de error» en otros flujos'],
    definition: {
      nodes: [
        node('trigger', 'trigger', 'Error recibido', 80, 160),
        node('mensaje', 'transform', 'Armar mensaje', 360, 160, {
          output: {
            texto: 'El flujo «{{ input.workflow.name }}» falló en el nodo {{ input.failedNode.name | default:\'desconocido\' }}: {{ input.error }}',
            ejecucion: '{{ input.execution.id }}',
          },
        }),
        node('notificar', 'connector', 'Enviar notificación', 640, 160, {
          operationId: '',
          input: { texto: '{{ nodes.mensaje.output.texto }}', ejecucion: '{{ nodes.mensaje.output.ejecucion }}' },
          retries: 2,
        }),
      ],
      edges: [edge('trigger', 'mensaje'), edge('mensaje', 'notificar')],
    },
  },
  {
    id: 'daily-summary',
    name: 'Resumen diario con agente',
    description: 'De lunes a viernes a las 8:00 un agente genera un resumen y el flujo lo devuelve.',
    icon: 'sparkles',
    todo: ['Elegir el agente', 'Ajustar la programación en la pestaña «Flujo» y activar el flujo'],
    schedule: '0 8 * * 1-5',
    definition: {
      nodes: [
        node('trigger', 'trigger', 'Cada mañana', 80, 160),
        node('resumen', 'agent', 'Generar resumen', 360, 160, {
          agentId: '',
          message: 'Genera el resumen diario de actividad con tus herramientas disponibles. Sé breve y usa viñetas.',
          parseJson: false,
        }),
        node('respuesta', 'output', 'Resumen', 640, 160, { output: { resumen: '{{ nodes.resumen.output.text }}' } }),
      ],
      edges: [edge('trigger', 'resumen'), edge('resumen', 'respuesta')],
    },
  },
  {
    id: 'lead-commercial',
    name: 'Lead entrante → enriquecer → calificar con IA → crear en CRM → notificar',
    description:
      'Recibe un lead por webhook, lo enriquece (p. ej. Lusha), un agente lo califica con BANT y, si el puntaje es ≥ 70, lo crea en el CRM y avisa al equipo.',
    icon: 'target',
    todo: [
      'Elegir la operación de enriquecimiento en «Enriquecer lead» (p. ej. Lusha)',
      'Elegir el agente calificador (sugerido: con la skill «Calificación BANT»)',
      'Elegir la operación del CRM en «Crear en CRM» y la de mensajería en «Notificar al equipo»',
      'Activar el flujo para habilitar el webhook',
    ],
    definition: {
      nodes: [
        node('trigger', 'trigger', 'Lead entrante', 80, 220),
        node('enriquecer', 'connector', 'Enriquecer lead', 340, 220, {
          operationId: '',
          input: { email: '{{ input.email }}', empresa: '{{ input.empresa }}' },
          retries: 1,
          onError: 'continue',
        }),
        node('calificar', 'agent', 'Calificar con IA (BANT)', 600, 220, {
          agentId: '',
          message:
            'Califica este lead con el método BANT (presupuesto, autoridad, necesidad, tiempo). Responde solo JSON con la forma ' +
            '{"score": 0-100, "presupuesto": "...", "autoridad": "...", "necesidad": "...", "tiempo": "...", "resumen": "..."}.\n\n' +
            'Lead: {{ input | json }}\n\nDatos de enriquecimiento: {{ nodes.enriquecer.output.data | json }}',
          parseJson: true,
        }),
        node('calificado', 'condition', '¿Score ≥ 70?', 860, 220, {
          combinator: 'and',
          rules: [{ left: '{{ nodes.calificar.output.json.score }}', operator: 'gte', right: 70 }],
        }),
        node('crm', 'connector', 'Crear en CRM', 1120, 120, {
          operationId: '',
          input: {
            nombre: '{{ input.nombre }}',
            email: '{{ input.email }}',
            empresa: '{{ input.empresa }}',
            score: '{{ nodes.calificar.output.json.score }}',
            notas: '{{ nodes.calificar.output.json.resumen }}',
          },
          retries: 2,
        }),
        node('notificar', 'connector', 'Notificar al equipo', 1380, 120, {
          operationId: '',
          input: {
            texto: 'Nuevo lead calificado: {{ input.nombre }} ({{ input.empresa }}) · score {{ nodes.calificar.output.json.score }}',
          },
          retries: 2,
        }),
        node('nutricion', 'transform', 'Lead en nutrición', 1120, 320, {
          output: { estado: 'nutricion', score: '{{ nodes.calificar.output.json.score }}', motivo: '{{ nodes.calificar.output.json.resumen }}' },
        }),
        node('respuesta', 'output', 'Respuesta', 1640, 220, {
          output: { recibido: true, score: '{{ nodes.calificar.output.json.score }}', bant: '{{ nodes.calificar.output.json }}' },
        }),
      ],
      edges: [
        edge('trigger', 'enriquecer'),
        edge('enriquecer', 'calificar'),
        edge('calificar', 'calificado'),
        edge('calificado', 'crm', 'true'),
        edge('crm', 'notificar'),
        edge('notificar', 'respuesta'),
        edge('calificado', 'nutricion', 'false'),
        edge('nutricion', 'respuesta'),
      ],
    },
  },
];
