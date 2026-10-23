import { PATTERNS, WRITE_NOTICE, type CatalogEntry } from '../catalog.types';
import {
  GRAPH_BASE_URL,
  graphDocs,
  graphIdSchema,
  graphResourceDocs,
  microsoftAppCredentialFields,
  microsoftGraphAuth,
} from './microsoft-graph';

const SLUG = 'MS_PLANNER';
const SCOPES = ['Tasks.ReadWrite'];

const planIdSchema = graphIdSchema('Id del plan (campo "id" de "Listar mis planes")');
const taskIdSchema = graphIdSchema('Id de la tarea de Planner (campo "id")');
const bucketIdSchema = graphIdSchema('Id del bucket (campo "id" de "Listar buckets de un plan")');

const etagSchema = {
  type: 'string',
  pattern: PATTERNS.graphEtag,
  description:
    'ETag vigente de la tarea: valor exacto del campo "@odata.etag", ej. W/"JzEtVGFzayAgQEBAQEBAQEBAQEBAQEBAWCc=". ' +
    'Obténlo justo antes con "Obtener tarea" (o de un listado reciente); si Graph responde 412, vuelve a obtenerlo.',
};

const isoUtc = (what: string) => ({
  type: 'string',
  format: 'date-time',
  description: `${what} en ISO 8601 UTC, ej. "2026-11-05T17:00:00Z"`,
});

const assignmentsSchema = {
  type: 'object',
  description:
    'Asignaciones: objeto cuyas claves son ids de usuario de Entra ID (GUID) y cuyos valores son ' +
    '{ "@odata.type": "#microsoft.graph.plannerAssignment", "orderHint": " !" }. Ejemplo: ' +
    '{ "fbab97d0-4932-4511-b675-204639209557": { "@odata.type": "#microsoft.graph.plannerAssignment", ' +
    '"orderHint": " !" } }. En actualizaciones, un valor null quita la asignación de ese usuario.',
  maxProperties: 20,
  propertyNames: { pattern: PATTERNS.guid },
  additionalProperties: {
    type: ['object', 'null'],
    required: ['@odata.type', 'orderHint'],
    properties: {
      '@odata.type': { type: 'string', const: '#microsoft.graph.plannerAssignment' },
      orderHint: { type: 'string', maxLength: 100 },
    },
  },
};

const titleSchema = { type: 'string', minLength: 1, maxLength: 255, description: 'Título de la tarea' };
const prioritySchema = {
  type: 'integer',
  minimum: 0,
  maximum: 10,
  description: 'Prioridad 0-10 (1 = urgente, 3 = importante, 5 = media, 9 = baja)',
};

/** PATCH de Planner: exige `If-Match` con el etag y pide la tarea actualizada en la respuesta. */
const patchHeaders = { 'If-Match': '{{ input.etag }}', Prefer: 'return=representation' };

export const microsoftPlanner: CatalogEntry = {
  id: 'microsoft-planner',
  slug: SLUG,
  name: 'Microsoft Planner',
  category: 'PRODUCTIVIDAD',
  description:
    'Consultar planes, buckets y tareas de equipo en Microsoft Planner; crear, asignar, actualizar y completar ' +
    'tareas (Microsoft Graph, OAuth2; solo cuentas de trabajo o escuela).',
  icon: 'layers',
  docsUrl: graphResourceDocs('planner-overview'),
  connectorType: 'REST',
  config: { baseUrl: GRAPH_BASE_URL },
  auth: microsoftGraphAuth(SLUG, SCOPES),
  credentialFields: microsoftAppCredentialFields(`User.Read, ${SCOPES.join(', ')} (más offline_access)`),
  operations: [
    {
      key: 'list_my_plans',
      name: 'Listar mis planes',
      description:
        'Lista los planes de Planner compartidos con el usuario conectado (título, id, grupo contenedor). Úsala para ' +
        'obtener el planId antes de consultar o crear tareas.',
      write: false,
      inputSchema: { type: 'object', properties: {} },
      definition: { method: 'GET', path: '/me/planner/plans' },
      verified: true,
      docsUrl: graphDocs('planneruser-list-plans'),
    },
    {
      key: 'list_my_tasks',
      name: 'Listar mis tareas asignadas',
      description:
        'Lista las tareas de Planner asignadas al usuario conectado en todos sus planes (título, plan, bucket, ' +
        'vencimiento, % completado y @odata.etag). Úsala para revisar los pendientes del usuario.',
      write: false,
      inputSchema: { type: 'object', properties: {} },
      definition: { method: 'GET', path: '/me/planner/tasks' },
      verified: true,
      docsUrl: graphDocs('planneruser-list-tasks'),
    },
    {
      key: 'list_plan_tasks',
      name: 'Listar tareas de un plan',
      description:
        'Lista todas las tareas de un plan de Planner (título, bucket, asignaciones, vencimiento, % completado y ' +
        '@odata.etag). Úsala para ver el estado del trabajo de un equipo u obtener el taskId de una tarea.',
      write: false,
      inputSchema: { type: 'object', required: ['planId'], properties: { planId: planIdSchema } },
      definition: { method: 'GET', path: '/planner/plans/{{ input.planId }}/tasks' },
      verified: true,
      docsUrl: graphDocs('plannerplan-list-tasks'),
    },
    {
      key: 'list_plan_buckets',
      name: 'Listar buckets de un plan',
      description:
        'Lista los buckets (columnas) de un plan de Planner con su nombre e id. Úsala para elegir el bucketId antes ' +
        'de crear o mover una tarea.',
      write: false,
      inputSchema: { type: 'object', required: ['planId'], properties: { planId: planIdSchema } },
      definition: { method: 'GET', path: '/planner/plans/{{ input.planId }}/buckets' },
      verified: true,
      docsUrl: graphDocs('plannerplan-list-buckets'),
    },
    {
      key: 'get_task',
      name: 'Obtener tarea',
      description:
        'Obtiene una tarea de Planner con su @odata.etag vigente. Úsala SIEMPRE justo antes de "Actualizar tarea" o ' +
        '"Completar tarea", que exigen ese etag (cambia con cada modificación).',
      write: false,
      inputSchema: { type: 'object', required: ['taskId'], properties: { taskId: taskIdSchema } },
      definition: { method: 'GET', path: '/planner/tasks/{{ input.taskId }}' },
      verified: true,
      docsUrl: graphDocs('plannertask-get'),
    },
    {
      key: 'create_task',
      name: 'Crear tarea',
      description:
        `Crea una tarea en un plan de Planner, opcionalmente en un bucket, con vencimiento y personas asignadas ` +
        `${WRITE_NOTICE}. Obtén planId con "Listar mis planes" y bucketId con "Listar buckets de un plan"; los ` +
        'asignados se identifican por su id de usuario de Entra ID (GUID).',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['planId', 'title'],
        properties: {
          planId: planIdSchema,
          bucketId: bucketIdSchema,
          title: titleSchema,
          dueDateTime: isoUtc('Vencimiento'),
          startDateTime: isoUtc('Inicio'),
          priority: prioritySchema,
          assignments: assignmentsSchema,
        },
      },
      definition: {
        method: 'POST',
        path: '/planner/tasks',
        body: {
          planId: '{{ input.planId }}',
          bucketId: '{{ input.bucketId }}',
          title: '{{ input.title }}',
          dueDateTime: '{{ input.dueDateTime }}',
          startDateTime: '{{ input.startDateTime }}',
          priority: '{{ input.priority }}',
          assignments: '{{ input.assignments }}',
        },
      },
      verified: true,
      docsUrl: graphDocs('planner-post-tasks'),
    },
    {
      key: 'update_task',
      name: 'Actualizar tarea',
      description:
        `Modifica una tarea de Planner (título, vencimiento, prioridad, % completado, bucket o asignaciones) ` +
        `${WRITE_NOTICE}. Requiere el etag vigente: llama ANTES a "Obtener tarea" y pasa su "@odata.etag" sin ` +
        'cambios; si responde 412 (etag desactualizado), vuelve a obtenerlo y reintenta. Solo cambian los campos enviados.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['taskId', 'etag'],
        properties: {
          taskId: taskIdSchema,
          etag: etagSchema,
          title: titleSchema,
          dueDateTime: isoUtc('Nuevo vencimiento'),
          startDateTime: isoUtc('Nuevo inicio'),
          priority: prioritySchema,
          percentComplete: {
            type: 'integer',
            minimum: 0,
            maximum: 100,
            description: 'Porcentaje completado (100 = completada; 50 = en curso; 0 = sin iniciar)',
          },
          bucketId: bucketIdSchema,
          assignments: assignmentsSchema,
        },
      },
      definition: {
        method: 'PATCH',
        path: '/planner/tasks/{{ input.taskId }}',
        headers: patchHeaders,
        body: {
          title: '{{ input.title }}',
          dueDateTime: '{{ input.dueDateTime }}',
          startDateTime: '{{ input.startDateTime }}',
          priority: '{{ input.priority }}',
          percentComplete: '{{ input.percentComplete }}',
          bucketId: '{{ input.bucketId }}',
          assignments: '{{ input.assignments }}',
        },
      },
      verified: true,
      docsUrl: graphDocs('plannertask-update'),
    },
    {
      key: 'complete_task',
      name: 'Completar tarea',
      description:
        `Marca una tarea de Planner como completada (percentComplete = 100) ${WRITE_NOTICE}. Requiere el etag ` +
        'vigente: llama ANTES a "Obtener tarea" y pasa su "@odata.etag"; si responde 412, vuelve a obtenerlo.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['taskId', 'etag'],
        properties: { taskId: taskIdSchema, etag: etagSchema },
      },
      definition: {
        method: 'PATCH',
        path: '/planner/tasks/{{ input.taskId }}',
        headers: patchHeaders,
        body: { percentComplete: 100 },
      },
      verified: true,
      docsUrl: graphDocs('plannertask-update'),
    },
  ],
  verified: true,
  verificationNotes:
    'Verificado contra el repositorio fuente de learn.microsoft.com (microsoftgraph/microsoft-graph-docs-contrib, ' +
    'api-reference/v1.0) y sus tablas de permisos: GET /me/planner/plans, /me/planner/tasks, ' +
    '/planner/plans/{id}/tasks, /planner/plans/{id}/buckets y /planner/tasks/{id} (Tasks.Read), POST /planner/tasks ' +
    '(Tasks.ReadWrite; planId obligatorio, assignments con claves = id de usuario) y PATCH /planner/tasks/{id} ' +
    '(Tasks.ReadWrite; If-Match con el último etag obligatorio, 412 si cambió; Prefer: return=representation ' +
    'devuelve 200 con la tarea). Tasks.ReadWrite delegado no requiere consentimiento de administrador; Planner no ' +
    'admite cuentas personales y el usuario debe ser miembro del grupo de Microsoft 365 que contiene el plan.',
};
