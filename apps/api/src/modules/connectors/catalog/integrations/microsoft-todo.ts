import { WRITE_NOTICE, type CatalogEntry } from '../catalog.types';
import {
  dateTimeTimeZoneSchema,
  GRAPH_BASE_URL,
  graphDocs,
  graphIdSchema,
  graphResourceDocs,
  microsoftAppCredentialFields,
  microsoftGraphAuth,
} from './microsoft-graph';

const SLUG = 'MS_TODO';
const SCOPES = ['Tasks.ReadWrite'];

const listIdSchema = graphIdSchema('Id de la lista (campo "id" de "Listar listas de tareas")');
const taskIdSchema = graphIdSchema('Id de la tarea (campo "id" de "Listar tareas de una lista")');

const titleSchema = { type: 'string', minLength: 1, maxLength: 255, description: 'Título breve de la tarea' };
const importanceSchema = { type: 'string', enum: ['low', 'normal', 'high'], description: 'Importancia' };
const dueSchema = dateTimeTimeZoneSchema('Fecha de vencimiento');

export const microsoftTodo: CatalogEntry = {
  id: 'microsoft-todo',
  slug: SLUG,
  name: 'Microsoft To Do',
  category: 'PRODUCTIVIDAD',
  description:
    'Gestionar las tareas personales del usuario en Microsoft To Do: listas, tareas pendientes, crear recordatorios ' +
    'de seguimiento y marcarlos como completados (Microsoft Graph, OAuth2; cuentas personales y de trabajo).',
  icon: 'checkCircle',
  docsUrl: graphResourceDocs('todo-overview'),
  connectorType: 'REST',
  config: { baseUrl: GRAPH_BASE_URL },
  auth: microsoftGraphAuth(SLUG, SCOPES),
  credentialFields: microsoftAppCredentialFields(`User.Read, ${SCOPES.join(', ')} (más offline_access)`),
  operations: [
    {
      key: 'list_task_lists',
      name: 'Listar listas de tareas',
      description:
        'Lista las listas de tareas de To Do del usuario (nombre, id y si es la lista predeterminada "Tareas"). Úsala ' +
        'primero para obtener el listId que piden las demás operaciones.',
      write: false,
      inputSchema: { type: 'object', properties: {} },
      definition: { method: 'GET', path: '/me/todo/lists' },
      verified: true,
      docsUrl: graphDocs('todo-list-lists'),
    },
    {
      key: 'list_tasks',
      name: 'Listar tareas de una lista',
      description:
        'Lista las tareas de una lista de To Do (título, estado, importancia, vencimiento, notas), opcionalmente ' +
        'filtradas por estado. Úsala para revisar pendientes u obtener el taskId antes de actualizar o completar.',
      write: false,
      inputSchema: {
        type: 'object',
        required: ['listId'],
        properties: {
          listId: listIdSchema,
          statusFilter: {
            type: 'string',
            enum: [
              "status ne 'completed'",
              "status eq 'completed'",
              "status eq 'notStarted'",
              "status eq 'inProgress'",
              "status eq 'waitingOnOthers'",
              "status eq 'deferred'",
            ],
            description: 'Filtro OData por estado; "status ne \'completed\'" = solo pendientes. Vacío = todas',
          },
          top: { type: 'integer', minimum: 1, maximum: 100, description: 'Máximo de tareas a devolver' },
        },
      },
      definition: {
        method: 'GET',
        path: '/me/todo/lists/{{ input.listId }}/tasks',
        query: { $filter: '{{ input.statusFilter }}', $top: '{{ input.top }}' },
      },
      // El endpoint está documentado; el soporte de $filter por status y de $top no se detalla ("some OData").
      verified: false,
      docsUrl: graphDocs('todotasklist-list-tasks'),
    },
    {
      key: 'create_task',
      name: 'Crear tarea',
      description:
        `Crea una tarea en una lista de To Do del usuario ${WRITE_NOTICE}. Úsala para registrar un seguimiento o ` +
        'pendiente acordado (p. ej. "llamar a Ana el viernes"); obtén el listId con "Listar listas de tareas".',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['listId', 'title'],
        properties: {
          listId: listIdSchema,
          title: titleSchema,
          notes: { type: 'string', maxLength: 10000, description: 'Notas o detalle de la tarea (texto)' },
          dueDateTime: dueSchema,
          importance: importanceSchema,
        },
      },
      definition: {
        method: 'POST',
        path: '/me/todo/lists/{{ input.listId }}/tasks',
        body: {
          title: '{{ input.title }}',
          body: { content: "{{ input.notes | default:'' }}", contentType: 'text' },
          dueDateTime: '{{ input.dueDateTime }}',
          importance: '{{ input.importance }}',
        },
      },
      verified: true,
      docsUrl: graphDocs('todotasklist-post-tasks'),
    },
    {
      key: 'update_task',
      name: 'Actualizar tarea',
      description:
        `Modifica una tarea de To Do (título, notas, vencimiento, importancia o estado) ${WRITE_NOTICE}. Solo cambian ` +
        'los campos enviados. Obtén listId y taskId con "Listar tareas de una lista".',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['listId', 'taskId'],
        properties: {
          listId: listIdSchema,
          taskId: taskIdSchema,
          title: titleSchema,
          body: {
            type: 'object',
            required: ['content', 'contentType'],
            description:
              'Nuevas notas (reemplazan las anteriores): { "content": "<p>Detalle</p>", "contentType": "html" }',
            properties: {
              content: { type: 'string', maxLength: 10000 },
              contentType: { type: 'string', enum: ['html'] },
            },
          },
          dueDateTime: dueSchema,
          importance: importanceSchema,
          status: {
            type: 'string',
            enum: ['notStarted', 'inProgress', 'completed', 'waitingOnOthers', 'deferred'],
            description: 'Nuevo estado',
          },
        },
      },
      definition: {
        method: 'PATCH',
        path: '/me/todo/lists/{{ input.listId }}/tasks/{{ input.taskId }}',
        body: {
          title: '{{ input.title }}',
          body: '{{ input.body }}',
          dueDateTime: '{{ input.dueDateTime }}',
          importance: '{{ input.importance }}',
          status: '{{ input.status }}',
        },
      },
      verified: true,
      docsUrl: graphDocs('todotask-update'),
    },
    {
      key: 'complete_task',
      name: 'Completar tarea',
      description:
        `Marca una tarea de To Do como completada ${WRITE_NOTICE}. Úsala cuando el usuario confirme que el pendiente ` +
        'está hecho; obtén listId y taskId con "Listar tareas de una lista".',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['listId', 'taskId'],
        properties: { listId: listIdSchema, taskId: taskIdSchema },
      },
      definition: {
        method: 'PATCH',
        path: '/me/todo/lists/{{ input.listId }}/tasks/{{ input.taskId }}',
        body: { status: 'completed' },
      },
      verified: true,
      docsUrl: graphDocs('todotask-update'),
    },
  ],
  verified: false,
  verificationNotes:
    'Verificado contra el repositorio fuente de learn.microsoft.com (microsoftgraph/microsoft-graph-docs-contrib, ' +
    'api-reference/v1.0): GET /me/todo/lists y GET /me/todo/lists/{id}/tasks (Tasks.Read), POST ' +
    '/me/todo/lists/{id}/tasks y PATCH /me/todo/lists/{id}/tasks/{id} (Tasks.ReadWrite; en PATCH el cuerpo solo ' +
    'admite HTML), status notStarted|inProgress|completed|waitingOnOthers|deferred, dueDateTime dateTimeTimeZone. ' +
    'Tasks.ReadWrite (delegado) no requiere consentimiento de administrador y admite cuentas personales. Sin ' +
    'verificar: la documentación solo indica "some of the OData query parameters" para listar tareas, sin ' +
    'detallar $filter por status ni $top (por eso list_tasks queda verified: false).',
};
