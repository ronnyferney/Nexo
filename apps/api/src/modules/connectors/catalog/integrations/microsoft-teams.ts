import { WRITE_NOTICE, type CatalogEntry } from '../catalog.types';
import {
  GRAPH_BASE_URL,
  graphDocs,
  graphIdSchema,
  graphResourceDocs,
  microsoftAppCredentialFields,
  microsoftGraphAuth,
} from './microsoft-graph';

const SLUG = 'MS_TEAMS';
const SCOPES = [
  'Team.ReadBasic.All',
  'Channel.ReadBasic.All',
  'ChannelMessage.Send',
  'Chat.ReadBasic',
  'ChatMessage.Send',
  'OnlineMeetings.ReadWrite',
];

const teamIdSchema = graphIdSchema('Id del equipo (GUID, campo "id" de "Listar mis equipos")');
const channelIdSchema = graphIdSchema('Id del canal, ej. "19:4a95f7d8db4c4e7fae857bcebe0623e6@thread.tacv2"');
const chatIdSchema = graphIdSchema('Id del chat, ej. "19:2da4c29f6d7041eca70b638b43d45437@thread.v2"');

const messageProps = {
  content: { type: 'string', minLength: 1, description: 'Texto del mensaje' },
  contentType: { type: 'string', enum: ['text', 'html'], description: 'Formato del contenido (por defecto text)' },
};
const messageBody = { contentType: "{{ input.contentType | default:'text' }}", content: '{{ input.content }}' };

const isoWithOffset = (what: string) => ({
  type: 'string',
  format: 'date-time',
  description: `${what} en ISO 8601 con desfase, ej. "2026-11-05T15:00:00-05:00"`,
});

export const microsoftTeams: CatalogEntry = {
  id: 'microsoft-teams',
  slug: SLUG,
  name: 'Microsoft Teams',
  category: 'MENSAJERIA',
  description:
    'Publicar mensajes en canales y chats de Microsoft Teams y crear enlaces de reunión en línea en nombre del ' +
    'usuario (Microsoft Graph, OAuth2; solo cuentas de trabajo o escuela).',
  icon: 'users',
  docsUrl: graphResourceDocs('teams-api-overview'),
  connectorType: 'REST',
  config: { baseUrl: GRAPH_BASE_URL },
  auth: microsoftGraphAuth(SLUG, SCOPES),
  credentialFields: microsoftAppCredentialFields(`User.Read, ${SCOPES.join(', ')} (más offline_access)`),
  operations: [
    {
      key: 'list_joined_teams',
      name: 'Listar mis equipos',
      description:
        'Lista los equipos de Teams de los que el usuario es miembro directo (id, nombre, descripción, archivado). ' +
        'Úsala para obtener el teamId antes de listar canales o publicar en uno.',
      write: false,
      inputSchema: { type: 'object', properties: {} },
      definition: { method: 'GET', path: '/me/joinedTeams' },
      verified: true,
      docsUrl: graphDocs('user-list-joinedteams'),
    },
    {
      key: 'list_channels',
      name: 'Listar canales de un equipo',
      description:
        'Lista los canales visibles para el usuario en un equipo de Teams (id, nombre, descripción, tipo). Úsala para ' +
        'obtener el channelId antes de publicar un mensaje en el canal.',
      write: false,
      inputSchema: { type: 'object', required: ['teamId'], properties: { teamId: teamIdSchema } },
      definition: {
        method: 'GET',
        path: '/teams/{{ input.teamId }}/channels',
        // Excluir `email` mejora el rendimiento según la documentación.
        query: { $select: 'id,displayName,description,membershipType,webUrl' },
      },
      verified: true,
      docsUrl: graphDocs('channel-list'),
    },
    {
      key: 'list_chats',
      name: 'Listar mis chats',
      description:
        'Lista los chats del usuario (individuales, de grupo y de reunión) con su id, tema y tipo. Úsala para obtener ' +
        'el chatId antes de enviar un mensaje a un chat existente (la API no crea chats nuevos).',
      write: false,
      inputSchema: {
        type: 'object',
        properties: {
          top: { type: 'integer', minimum: 1, maximum: 50, description: 'Máximo de chats por página (máx. 50)' },
        },
      },
      definition: { method: 'GET', path: '/me/chats', query: { $top: '{{ input.top }}' } },
      verified: true,
      docsUrl: graphDocs('chat-list'),
    },
    {
      key: 'post_channel_message',
      name: 'Publicar mensaje en canal',
      description:
        `Publica un mensaje nuevo en un canal de Teams con el nombre del usuario conectado ${WRITE_NOTICE}. Úsala ` +
        'para avisar al equipo (lead caliente, negocio cerrado...); no la uses como registro de eventos (lo prohíben ' +
        'los términos de Microsoft). Obtén teamId y channelId con "Listar mis equipos" y "Listar canales de un equipo".',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['teamId', 'channelId', 'content'],
        properties: {
          teamId: teamIdSchema,
          channelId: channelIdSchema,
          subject: { type: 'string', maxLength: 255, description: 'Asunto del hilo (opcional)' },
          ...messageProps,
        },
      },
      definition: {
        method: 'POST',
        path: '/teams/{{ input.teamId }}/channels/{{ input.channelId }}/messages',
        body: { subject: '{{ input.subject }}', body: messageBody },
      },
      verified: true,
      docsUrl: graphDocs('channel-post-messages'),
    },
    {
      key: 'send_chat_message',
      name: 'Enviar mensaje a un chat',
      description:
        `Envía un mensaje a un chat existente de Teams (individual o de grupo) en nombre del usuario ${WRITE_NOTICE}. ` +
        'Úsala solo cuando el usuario lo pida; obtén el chatId con "Listar mis chats".',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['chatId', 'content'],
        properties: { chatId: chatIdSchema, ...messageProps },
      },
      definition: {
        method: 'POST',
        path: '/chats/{{ input.chatId }}/messages',
        body: { body: messageBody },
      },
      verified: true,
      docsUrl: graphDocs('chat-post-messages'),
    },
    {
      key: 'create_online_meeting',
      name: 'Crear reunión en línea de Teams',
      description:
        `Crea una reunión de Teams independiente y devuelve su enlace de acceso (joinWebUrl) ${WRITE_NOTICE}. No ` +
        'aparece en el calendario ni envía invitaciones: úsala para obtener un enlace que compartir. Para agendar ' +
        'con invitaciones, usa "Crear evento o reunión" del Calendario corporativo con Teams.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['subject', 'startDateTime', 'endDateTime'],
        properties: {
          subject: { type: 'string', minLength: 1, maxLength: 255, description: 'Título de la reunión' },
          startDateTime: isoWithOffset('Inicio'),
          endDateTime: isoWithOffset('Fin'),
        },
      },
      definition: {
        method: 'POST',
        path: '/me/onlineMeetings',
        body: {
          subject: '{{ input.subject }}',
          startDateTime: '{{ input.startDateTime }}',
          endDateTime: '{{ input.endDateTime }}',
        },
      },
      verified: true,
      docsUrl: graphDocs('application-post-onlinemeetings'),
    },
  ],
  verified: true,
  verificationNotes:
    'Verificado contra el repositorio fuente de learn.microsoft.com (microsoftgraph/microsoft-graph-docs-contrib, ' +
    'api-reference/v1.0) y sus tablas de permisos: GET /me/joinedTeams (Team.ReadBasic.All), GET ' +
    '/teams/{id}/channels con $select (Channel.ReadBasic.All), GET /me/chats con $top <= 50 (Chat.ReadBasic), POST ' +
    '/teams/{id}/channels/{id}/messages (ChannelMessage.Send; solo body es obligatorio), POST /chats/{id}/messages ' +
    '(ChatMessage.Send; no crea chats) y POST /me/onlineMeetings con subject/startDateTime/endDateTime ' +
    '(OnlineMeetings.ReadWrite; devuelve joinWebUrl y no aparece en el calendario). Ninguno de estos permisos ' +
    'delegados requiere consentimiento de administrador (los *.All sí lo requieren solo como permisos de ' +
    'aplicación), aunque muchos tenants bloquean el consentimiento de usuarios para Teams. Ninguna operación admite ' +
    'cuentas personales de Microsoft.',
};
