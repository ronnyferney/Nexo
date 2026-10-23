import { OAUTH_PROVIDERS } from '../../../oauth/oauth.providers';
import { secretRef, WRITE_NOTICE, type CatalogEntry, type CatalogOperation } from '../catalog.types';

const SLACK = 'SLACK';
const SLACK_DOCS = 'https://docs.slack.dev/reference/methods/chat.postMessage/';
const method = (name: string) => `https://docs.slack.dev/reference/methods/${name}/`;

/** Patrones de identificadores de Slack (las entradas viajan en query/cuerpo; se validan igualmente). */
export const SLACK_PATTERNS = {
  /** Id de conversación: C (canal), G (privado/heredado), D (mensaje directo). */
  conversationId: String.raw`^[CGD][A-Z0-9]{2,30}$`,
  /** Id de conversación o nombre de canal (#ventas), como admite chat.postMessage. */
  conversation: String.raw`^(?:[CGD][A-Z0-9]{2,30}|#?[a-z0-9][a-z0-9._-]{0,79})$`,
  userId: String.raw`^[UW][A-Z0-9]{2,30}$`,
  /** `ts` de un mensaje: segundos Unix + fracción (1712345678.123456). */
  messageTs: String.raw`^[0-9]{9,12}\.[0-9]{1,8}$`,
  /** Marca de tiempo Unix para filtros oldest/latest (fracción opcional). */
  unixTs: String.raw`^[0-9]{1,12}(?:\.[0-9]{1,8})?$`,
  /** `next_cursor` opaco de la paginación de Slack (base64). */
  cursor: String.raw`^[A-Za-z0-9+/=_-]{1,1000}$`,
  /** Nombre de emoji sin dos puntos, con tono de piel opcional (thumbsup, +1, white_check_mark::skin-tone-2). */
  emoji: String.raw`^[a-z0-9_+-]{1,100}(?:::skin-tone-[2-6])?$`,
  /** Tipos de conversación cubiertos por los scopes solicitados (sin mpim). */
  types: String.raw`^(?:public_channel|private_channel|im)(?:,(?:public_channel|private_channel|im)){0,2}$`,
} as const;

/**
 * Scopes de bot (OAuth v2) mínimos para todas las operaciones del catálogo. Slack los recibe separados por coma
 * en el parámetro `scope` de https://slack.com/oauth/v2/authorize.
 */
export const SLACK_BOT_SCOPES = [
  'chat:write', // post_message, reply_in_thread, post_blocks_message, update_message, schedule_message
  'channels:read', // list_channels (public_channel)
  'groups:read', // list_channels (private_channel)
  'im:read', // list_channels (im)
  'channels:history', // get_channel_history, get_thread_replies (canales públicos)
  'groups:history', // ídem en canales privados
  'im:history', // ídem en mensajes directos
  'reactions:write', // add_reaction
  'users:read', // get_user_info (y requisito de users:read.email)
  'users:read.email', // lookup_user_by_email
  'im:write', // open_direct_message
  'channels:join', // join_channel
];

const text = (description: string) => ({ type: 'string', minLength: 1, maxLength: 40000, description });
const conversationId = (description: string) => ({
  type: 'string',
  pattern: SLACK_PATTERNS.conversationId,
  description,
});
const messageTs = (description: string) => ({ type: 'string', pattern: SLACK_PATTERNS.messageTs, description });
const limit = (max: number, description: string) => ({ type: 'integer', minimum: 1, maximum: max, description });
const cursor = {
  type: 'string',
  pattern: SLACK_PATTERNS.cursor,
  description: 'response_metadata.next_cursor de la página anterior (vacío = primera página)',
};
const blocks = {
  type: 'array',
  minItems: 1,
  maxItems: 50,
  description: 'Bloques Block Kit (máx. 50), p. ej. [{"type":"section","text":{"type":"mrkdwn","text":"*Hola*"}}]',
  items: { type: 'object', required: ['type'], properties: { type: { type: 'string', minLength: 1 } } },
};

const operations: CatalogOperation[] = [
  {
    key: 'post_message',
    name: 'Publicar mensaje en canal',
    description:
      `Publica un mensaje en un canal de Slack (o responde en un hilo) ${WRITE_NOTICE}. Úsala para notificar al ` +
      'equipo (p. ej. lead caliente, negocio creado).',
    write: true,
    inputSchema: {
      type: 'object',
      required: ['channel', 'text'],
      properties: {
        channel: { type: 'string', description: 'Id del canal (C0123...) o nombre (#ventas)' },
        text: { type: 'string', minLength: 1, description: 'Texto del mensaje (admite formato mrkdwn de Slack)' },
        thread_ts: { type: 'string', description: 'ts del mensaje padre para responder en hilo (opcional)' },
      },
    },
    definition: {
      method: 'POST',
      path: '/chat.postMessage',
      // Slack responde HTTP 200 con `ok: false` ante errores de negocio (canal inexistente, sin permisos...).
      successPath: 'ok',
      body: { channel: '{{ input.channel }}', text: '{{ input.text }}', thread_ts: '{{ input.thread_ts }}' },
    },
    verified: true,
    docsUrl: SLACK_DOCS,
  },
  {
    key: 'reply_in_thread',
    name: 'Responder en hilo',
    description:
      `Responde dentro del hilo de un mensaje existente ${WRITE_NOTICE}. Úsala cuando la conversación ya tiene un ` +
      'mensaje padre (su `ts`, devuelto al publicar o en el historial) para no saturar el canal; con ' +
      'reply_broadcast=true la respuesta también se muestra en el canal.',
    write: true,
    inputSchema: {
      type: 'object',
      required: ['channel', 'thread_ts', 'text'],
      additionalProperties: false,
      properties: {
        channel: conversationId('Id del canal o conversación del mensaje padre (C0123..., G..., D...)'),
        thread_ts: messageTs('ts del mensaje padre (no el de otra respuesta), p. ej. 1712345678.123456'),
        text: text('Texto de la respuesta (mrkdwn de Slack)'),
        reply_broadcast: { type: 'boolean', description: 'true = mostrar también en el canal (por defecto false)' },
      },
    },
    definition: {
      method: 'POST',
      path: '/chat.postMessage',
      successPath: 'ok',
      body: {
        channel: '{{ input.channel }}',
        thread_ts: '{{ input.thread_ts }}',
        text: '{{ input.text }}',
        reply_broadcast: '{{ input.reply_broadcast }}',
      },
    },
    verified: true,
    docsUrl: method('chat.postMessage'),
  },
  {
    key: 'post_blocks_message',
    name: 'Publicar mensaje con bloques (Block Kit)',
    description:
      `Publica un mensaje con formato enriquecido Block Kit (secciones, campos, botones de enlace...) ${WRITE_NOTICE}. ` +
      'Úsala para resúmenes estructurados (ficha de un lead, tabla de métricas). `text` es el texto alternativo de ' +
      'notificaciones y lectores de pantalla.',
    write: true,
    inputSchema: {
      type: 'object',
      required: ['channel', 'blocks', 'text'],
      additionalProperties: false,
      properties: {
        channel: {
          type: 'string',
          pattern: SLACK_PATTERNS.conversation,
          description: 'Id del canal (C0123...) o nombre (#ventas)',
        },
        blocks,
        text: text('Texto alternativo (notificación push y accesibilidad)'),
        thread_ts: messageTs('ts del mensaje padre para publicarlo en un hilo (opcional)'),
      },
    },
    definition: {
      method: 'POST',
      path: '/chat.postMessage',
      successPath: 'ok',
      body: {
        channel: '{{ input.channel }}',
        blocks: '{{ input.blocks }}',
        text: '{{ input.text }}',
        thread_ts: '{{ input.thread_ts }}',
      },
    },
    verified: true,
    docsUrl: method('chat.postMessage'),
  },
  {
    key: 'update_message',
    name: 'Actualizar mensaje',
    description:
      `Edita un mensaje que publicó este bot (texto y/o bloques) ${WRITE_NOTICE}. Úsala para reflejar cambios de ` +
      'estado en una notificación previa (p. ej. "Negocio ganado"); requiere el id del canal y el `ts` del mensaje.',
    write: true,
    inputSchema: {
      type: 'object',
      required: ['channel', 'ts'],
      additionalProperties: false,
      anyOf: [{ required: ['text'] }, { required: ['blocks'] }],
      properties: {
        channel: conversationId('Id del canal donde está el mensaje (C0123...)'),
        ts: messageTs('ts del mensaje a editar'),
        text: text('Nuevo texto (o texto alternativo si se envían bloques)'),
        blocks,
      },
    },
    definition: {
      method: 'POST',
      path: '/chat.update',
      successPath: 'ok',
      body: {
        channel: '{{ input.channel }}',
        ts: '{{ input.ts }}',
        text: '{{ input.text }}',
        blocks: '{{ input.blocks }}',
      },
    },
    verified: true,
    docsUrl: method('chat.update'),
  },
  {
    key: 'schedule_message',
    name: 'Programar mensaje',
    description:
      `Programa un mensaje para que Slack lo publique en una fecha futura ${WRITE_NOTICE}. Úsala para recordatorios ` +
      '(p. ej. seguimiento de una propuesta); post_at es la hora en segundos Unix y debe ser futura (Slack rechaza ' +
      'fechas pasadas o demasiado lejanas con time_in_past / time_too_far). Devuelve scheduled_message_id.',
    write: true,
    inputSchema: {
      type: 'object',
      required: ['channel', 'text', 'post_at'],
      additionalProperties: false,
      properties: {
        channel: {
          type: 'string',
          pattern: SLACK_PATTERNS.conversation,
          description: 'Id del canal (C0123...) o nombre (#ventas)',
        },
        text: text('Texto del mensaje (o alternativo si se envían bloques)'),
        post_at: { type: 'integer', minimum: 1, maximum: 99999999999, description: 'Hora de envío, segundos Unix' },
        thread_ts: messageTs('ts del mensaje padre para programarlo en un hilo (opcional)'),
        blocks,
      },
    },
    definition: {
      method: 'POST',
      path: '/chat.scheduleMessage',
      successPath: 'ok',
      body: {
        channel: '{{ input.channel }}',
        text: '{{ input.text }}',
        post_at: '{{ input.post_at }}',
        thread_ts: '{{ input.thread_ts }}',
        blocks: '{{ input.blocks }}',
      },
    },
    verified: true,
    docsUrl: method('chat.scheduleMessage'),
  },
  {
    key: 'add_reaction',
    name: 'Agregar reacción',
    description:
      `Agrega una reacción con emoji a un mensaje ${WRITE_NOTICE}. Úsala para acusar recibo o marcar estado sin ` +
      'escribir (p. ej. white_check_mark al atender una solicitud). Si ya existe, Slack responde already_reacted.',
    write: true,
    inputSchema: {
      type: 'object',
      required: ['channel', 'timestamp', 'name'],
      additionalProperties: false,
      properties: {
        channel: conversationId('Id del canal del mensaje (C0123...)'),
        timestamp: messageTs('ts del mensaje'),
        name: { type: 'string', pattern: SLACK_PATTERNS.emoji, description: 'Emoji sin dos puntos, p. ej. thumbsup' },
      },
    },
    definition: {
      method: 'POST',
      path: '/reactions.add',
      successPath: 'ok',
      bodyType: 'form',
      body: { channel: '{{ input.channel }}', timestamp: '{{ input.timestamp }}', name: '{{ input.name }}' },
    },
    verified: true,
    docsUrl: method('reactions.add'),
  },
  {
    key: 'open_direct_message',
    name: 'Abrir mensaje directo',
    description:
      `Abre (o recupera si ya existe) la conversación directa entre el bot y un usuario y devuelve su id en ` +
      `channel.id ${WRITE_NOTICE}. Úsala antes de post_message para escribirle por privado a una persona (obtén su ` +
      'id con lookup_user_by_email).',
    write: true,
    inputSchema: {
      type: 'object',
      required: ['user'],
      additionalProperties: false,
      properties: {
        user: { type: 'string', pattern: SLACK_PATTERNS.userId, description: 'Id del usuario (U0123...)' },
      },
    },
    definition: {
      method: 'POST',
      path: '/conversations.open',
      successPath: 'ok',
      bodyType: 'form',
      body: { users: '{{ input.user }}' },
    },
    verified: true,
    docsUrl: method('conversations.open'),
  },
  {
    key: 'join_channel',
    name: 'Unirse a canal público',
    description:
      `Une el bot a un canal público para poder leer su historial o publicar en él ${WRITE_NOTICE}. Úsala cuando ` +
      'otra operación falle con not_in_channel en un canal público; los canales privados requieren que una persona ' +
      'invite al bot.',
    write: true,
    inputSchema: {
      type: 'object',
      required: ['channel'],
      additionalProperties: false,
      properties: { channel: conversationId('Id del canal público (C0123...)') },
    },
    definition: {
      method: 'POST',
      path: '/conversations.join',
      successPath: 'ok',
      bodyType: 'form',
      body: { channel: '{{ input.channel }}' },
    },
    verified: true,
    docsUrl: method('conversations.join'),
  },
  {
    key: 'list_channels',
    name: 'Listar canales',
    description:
      'Lista canales del espacio de trabajo (id, nombre, si el bot es miembro) con paginación por cursor. Úsala para ' +
      'encontrar el id de un canal por su nombre antes de leer o publicar; los privados solo aparecen si el bot es ' +
      'miembro.',
    write: false,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        types: {
          type: 'string',
          pattern: SLACK_PATTERNS.types,
          description: 'Tipos separados por coma: public_channel, private_channel, im (por defecto public_channel)',
        },
        exclude_archived: { type: 'boolean', description: 'true = omitir canales archivados (recomendado)' },
        limit: limit(999, 'Máximo por página (Slack recomienda ≤ 200; por defecto 100)'),
        cursor,
      },
    },
    definition: {
      method: 'GET',
      path: '/conversations.list',
      successPath: 'ok',
      query: {
        types: '{{ input.types }}',
        exclude_archived: '{{ input.exclude_archived }}',
        limit: '{{ input.limit }}',
        cursor: '{{ input.cursor }}',
      },
    },
    verified: true,
    docsUrl: method('conversations.list'),
  },
  {
    key: 'get_channel_history',
    name: 'Historial de un canal',
    description:
      'Lee los mensajes de un canal o conversación directa, del más reciente al más antiguo, con filtros por rango ' +
      '(oldest/latest en segundos Unix) y paginación por cursor. Úsala para resumir actividad reciente; el bot debe ' +
      'ser miembro del canal.',
    write: false,
    inputSchema: {
      type: 'object',
      required: ['channel'],
      additionalProperties: false,
      properties: {
        channel: conversationId('Id del canal o conversación (C0123..., G..., D...)'),
        oldest: { type: 'string', pattern: SLACK_PATTERNS.unixTs, description: 'Solo mensajes posteriores (Unix)' },
        latest: { type: 'string', pattern: SLACK_PATTERNS.unixTs, description: 'Solo mensajes anteriores (Unix)' },
        limit: limit(999, 'Máximo por página (por defecto 100)'),
        cursor,
      },
    },
    definition: {
      method: 'GET',
      path: '/conversations.history',
      successPath: 'ok',
      query: {
        channel: '{{ input.channel }}',
        oldest: '{{ input.oldest }}',
        latest: '{{ input.latest }}',
        limit: '{{ input.limit }}',
        cursor: '{{ input.cursor }}',
      },
    },
    verified: true,
    docsUrl: method('conversations.history'),
  },
  {
    key: 'get_thread_replies',
    name: 'Respuestas de un hilo',
    description:
      'Lee el mensaje padre y las respuestas de un hilo (orden cronológico) con paginación por cursor. Úsala para ' +
      'entender una conversación completa antes de responder en ella; el bot debe ser miembro del canal.',
    write: false,
    inputSchema: {
      type: 'object',
      required: ['channel', 'ts'],
      additionalProperties: false,
      properties: {
        channel: conversationId('Id del canal del hilo (C0123...)'),
        ts: messageTs('ts del mensaje padre del hilo'),
        oldest: { type: 'string', pattern: SLACK_PATTERNS.unixTs, description: 'Solo respuestas posteriores (Unix)' },
        latest: { type: 'string', pattern: SLACK_PATTERNS.unixTs, description: 'Solo respuestas anteriores (Unix)' },
        limit: limit(999, 'Máximo por página'),
        cursor,
      },
    },
    definition: {
      method: 'GET',
      path: '/conversations.replies',
      successPath: 'ok',
      query: {
        channel: '{{ input.channel }}',
        ts: '{{ input.ts }}',
        oldest: '{{ input.oldest }}',
        latest: '{{ input.latest }}',
        limit: '{{ input.limit }}',
        cursor: '{{ input.cursor }}',
      },
    },
    verified: true,
    docsUrl: method('conversations.replies'),
  },
  {
    key: 'lookup_user_by_email',
    name: 'Buscar usuario por correo',
    description:
      'Busca a una persona del espacio de trabajo por su correo y devuelve su id (U...), nombre y perfil. Úsala para ' +
      'pasar de un correo del CRM a un usuario de Slack (mencionarlo con <@U...> o abrirle un mensaje directo); si ' +
      'no existe Slack responde users_not_found.',
    write: false,
    inputSchema: {
      type: 'object',
      required: ['email'],
      additionalProperties: false,
      properties: { email: { type: 'string', format: 'email', maxLength: 254, description: 'Correo de la persona' } },
    },
    definition: {
      method: 'GET',
      path: '/users.lookupByEmail',
      successPath: 'ok',
      query: { email: '{{ input.email }}' },
    },
    verified: true,
    docsUrl: method('users.lookupByEmail'),
  },
  {
    key: 'get_user_info',
    name: 'Información de usuario',
    description:
      'Obtiene el perfil de un usuario por id (nombre real, cargo, zona horaria, si es bot o está desactivado). ' +
      'Úsala para identificar al autor de un mensaje del historial o adaptar un recordatorio a su zona horaria.',
    write: false,
    inputSchema: {
      type: 'object',
      required: ['user'],
      additionalProperties: false,
      properties: {
        user: { type: 'string', pattern: SLACK_PATTERNS.userId, description: 'Id del usuario (U0123...)' },
      },
    },
    definition: {
      method: 'GET',
      path: '/users.info',
      successPath: 'ok',
      query: { user: '{{ input.user }}' },
    },
    verified: true,
    docsUrl: method('users.info'),
  },
];

export const slack: CatalogEntry = {
  id: 'slack',
  slug: SLACK,
  name: 'Slack',
  category: 'MENSAJERIA',
  description:
    'Publicar, programar y editar mensajes (texto o Block Kit), responder en hilos, reaccionar, leer canales e ' +
    'hilos y buscar usuarios de Slack, con token de bot o "Agregar a Slack" (OAuth v2).',
  icon: 'bell',
  docsUrl: SLACK_DOCS,
  connectorType: 'REST',
  config: { baseUrl: 'https://slack.com/api' },
  auth: {
    // Primero = predeterminado: las instalaciones existentes con token de bot no cambian.
    bearer: { type: 'bearer', token: secretRef(SLACK, 'botToken') },
    oauth2_code: {
      type: 'oauth2_code',
      provider: 'slack',
      authorizeUrl: OAUTH_PROVIDERS.slack.authorizeUrl,
      tokenUrl: OAUTH_PROVIDERS.slack.tokenUrl,
      scopes: SLACK_BOT_SCOPES,
      // OAuth v2 de Slack: scopes de bot separados por coma en `scope`; el token de bot llega en `access_token`.
      scopeSeparator: ',',
      // El flujo web documentado (app con client secret) no usa PKCE; el `state` firmado sigue protegiendo el flujo.
      pkce: false,
      clientIdRef: secretRef(SLACK, 'clientId'),
      clientSecretRef: secretRef(SLACK, 'clientSecret'),
      accountLabel: { tokenField: 'team.name' },
    },
  },
  credentialFields: [
    {
      key: 'botToken',
      label: 'Token de bot (xoxb-...)',
      secret: true,
      required: true,
      authMethods: ['bearer'],
      pattern: String.raw`^xox[A-Za-z0-9._-]{4,}$`,
      help:
        'api.slack.com/apps → OAuth & Permissions → Bot User OAuth Token. Scopes de bot por operación: chat:write ' +
        '(publicar, responder, bloques, actualizar, programar); channels:read, groups:read, im:read (listar canales); ' +
        'channels:history, groups:history, im:history (historial e hilos); reactions:write (reacciones); users:read ' +
        '(info de usuario); users:read + users:read.email (buscar por correo); im:write (mensaje directo); ' +
        'channels:join (unirse a canal). Reinstale la app tras agregar scopes e invite el bot a los canales privados.',
    },
    {
      key: 'clientId',
      label: 'Client ID de la app de Slack (app propia, opcional)',
      secret: false,
      required: false,
      authMethods: ['oauth2_code'],
      pattern: String.raw`^[0-9]{1,20}\.[0-9]{1,20}$`,
      help:
        'Vacío = app de Slack de la plataforma Nexo. App propia: api.slack.com/apps → Basic Information → App ' +
        'Credentials; en OAuth & Permissions agregue la Redirect URL <API>/api/oauth/callback y los scopes de bot: ' +
        `${SLACK_BOT_SCOPES.join(', ')}.`,
    },
    {
      key: 'clientSecret',
      label: 'Client secret (app propia, opcional)',
      secret: true,
      required: false,
      authMethods: ['oauth2_code'],
    },
  ],
  operations,
  verified: true,
  verificationNotes:
    'docs.slack.dev y api.slack.com no fueron accesibles desde el entorno de verificación (proxy); se verificó con ' +
    'fuentes oficiales de slackapi en GitHub/npm: la especificación OpenAPI de la Web API (slackapi/slack-api-specs, ' +
    'archivada pero oficial: métodos, parámetros, content types y errores), los tipos de argumentos de ' +
    '@slack/web-api 8.2 y el cliente de python-slack-sdk (verbo HTTP y codificación por método), y los javadoc de ' +
    'java-slack-sdk. Lecturas (conversations.list/history/replies, users.lookupByEmail, users.info) por GET con query ' +
    'string, como python-slack-sdk; chat.postMessage/update/scheduleMessage en JSON (necesario para `blocks`); ' +
    'reactions.add, conversations.open y conversations.join en form-urlencoded (formato que admiten todos los ' +
    'métodos). Slack responde HTTP 200 con `ok: false` ante errores de negocio: todas las operaciones usan ' +
    'successPath "ok". Scopes de bot según el `security` de la especificación OpenAPI (channels/groups/im :read y ' +
    ':history, chat:write, reactions:write, users:read, users:read.email, im:write); para conversations.join con ' +
    'token de bot se usa channels:join (la especificación heredada indica channels:write, scope de usuario) según los ' +
    'ejemplos oficiales de java-slack-sdk. No se piden scopes mpim:*, por lo que list_channels no admite el tipo mpim. ' +
    'OAuth v2 ("Agregar a Slack"): authorize https://slack.com/oauth/v2/authorize con scopes separados por coma, ' +
    'intercambio en https://slack.com/api/oauth.v2.access (form con client_id/client_secret, grant_type ' +
    'authorization_code | refresh_token), token de bot en access_token y equipo en team.name (tipos OAuthV2Response ' +
    'de @slack/oauth). Sin rotación de tokens Slack no envía refresh_token ni expires_in y el token no caduca; con ' +
    'rotación activa se renueva con refresh_token. Sin PKCE (opcional en Slack, pkce_enabled del manifiesto). La ' +
    'desconexión borra el token en Nexo pero no desinstala la app en Slack (auth.revoke no es RFC 7009).',
};
