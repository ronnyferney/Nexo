import { PATTERNS, WRITE_NOTICE, type CatalogEntry, type CatalogOperation } from '../catalog.types';
import { googleOAuth, googleOwnAppFields } from './google-oauth';

const GMAIL = 'GMAIL';
const GMAIL_INBOX = 'GMAIL_INBOX';
const REF = 'https://developers.google.com/workspace/gmail/api/reference/rest/v1';

/**
 * Separador de las cargas multipart (metadatos JSON + mensaje RFC 822). El cuerpo del correo no puede contenerlo
 * (ver `bodyWithoutBoundary`): así un texto no puede cerrar la parte del mensaje e inyectar otra.
 */
export const GMAIL_MULTIPART_BOUNDARY = 'nexo-part-5f1c9a7e3b2d';

/** Ids de mensajes e hilos de Gmail (hexadecimales). */
const gmailId = (description: string) => ({ type: 'string', pattern: '^[A-Za-z0-9]{1,64}$', description });
/** Message-ID RFC 5322: "<...>" sin espacios ni saltos de línea (va a la cabecera In-Reply-To). */
export const MESSAGE_ID_PATTERN = String.raw`^<[^<>\s]{1,250}>$`;
/** Lista de Message-ID separados por espacios (cabecera References), sin saltos de línea. */
export const REFERENCES_PATTERN = String.raw`^<[^<>\s]{1,250}>([ \t]+<[^<>\s]{1,250}>){0,50}$`;

const to = {
  type: 'string',
  pattern: PATTERNS.singleLine,
  description: 'Destinatario(s), separados por coma: "ana@acme.com, Luis <luis@acme.com>"',
};
const subject = { type: 'string', pattern: PATTERNS.singleLine, maxLength: 250, description: 'Asunto' };
const body = { type: 'string', description: 'Cuerpo del mensaje' };
const bodyWithoutBoundary = {
  type: 'string',
  pattern: `^(?![\\s\\S]*${GMAIL_MULTIPART_BOUNDARY})[\\s\\S]*$`,
  description: 'Cuerpo del mensaje',
};
const contentType = {
  type: 'string',
  enum: ['text/plain', 'text/html'],
  description: 'Formato del cuerpo (por defecto text/plain)',
};

const MIME_TAIL =
  'MIME-Version: 1.0\r\n' +
  "Content-Type: {{ input.contentType | default:'text/plain' }}; charset=UTF-8\r\n" +
  'Content-Transfer-Encoding: 8bit\r\n\r\n{{ input.body }}';
/** Mensaje RFC 822 nuevo (mismas cabeceras que send_email). */
const NEW_MESSAGE = 'To: {{ input.to }}\r\nSubject: {{ input.subject }}\r\n' + MIME_TAIL;
/** Respuesta: In-Reply-To = Message-ID del original; References = References del original + su Message-ID. */
const REPLY_MESSAGE =
  'To: {{ input.to }}\r\nSubject: {{ input.subject }}\r\n' +
  'In-Reply-To: {{ input.inReplyTo }}\r\nReferences: {{ input.references }} {{ input.inReplyTo }}\r\n' +
  MIME_TAIL;

/** Carga multipart/related: metadatos JSON (threadId) + mensaje message/rfc822. */
const multipart = (metadata: string) =>
  `--${GMAIL_MULTIPART_BOUNDARY}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
  `--${GMAIL_MULTIPART_BOUNDARY}\r\nContent-Type: message/rfc822\r\n\r\n${REPLY_MESSAGE}\r\n` +
  `--${GMAIL_MULTIPART_BOUNDARY}--`;
const multipartHeaders = { 'content-type': `multipart/related; boundary=${GMAIL_MULTIPART_BOUNDARY}` };

const replySchema = {
  type: 'object',
  required: ['threadId', 'inReplyTo', 'to', 'subject', 'body'],
  properties: {
    threadId: gmailId('threadId del correo al que se responde (de search_messages o get_message)'),
    inReplyTo: {
      type: 'string',
      pattern: MESSAGE_ID_PATTERN,
      description: 'Cabecera Message-ID del correo al que se responde, ej. "<CAF1x@mail.gmail.com>"',
    },
    references: {
      type: 'string',
      pattern: REFERENCES_PATTERN,
      maxLength: 4000,
      description: 'Cabecera References del correo original, si la tiene (se le agrega inReplyTo)',
    },
    to,
    subject: { ...subject, description: 'Asunto: el mismo del original con prefijo "Re: " (Gmail exige que coincida)' },
    body: bodyWithoutBoundary,
    contentType,
  },
};

/** Operación de envío compartida por Gmail (envío) y Gmail (bandeja y respuestas). */
const SEND_EMAIL: CatalogOperation = {
  key: 'send_email',
  name: 'Enviar correo',
  description:
    `Envía un correo desde la cuenta de Gmail conectada ${WRITE_NOTICE}. Úsala solo cuando el usuario o el ` +
    'flujo lo indiquen explícitamente (seguimientos, confirmaciones). Revisa destinatario y contenido antes.',
  write: true,
  inputSchema: {
    type: 'object',
    required: ['to', 'subject', 'body'],
    properties: { to, subject, body, contentType },
  },
  definition: {
    method: 'POST',
    path: '/upload/gmail/v1/users/me/messages/send',
    query: { uploadType: 'media' },
    headers: { 'content-type': 'message/rfc822' },
    bodyType: 'text',
    body: NEW_MESSAGE,
  },
  verified: false,
  docsUrl: 'https://developers.google.com/workspace/gmail/api/guides/uploads',
};

const READ_NOTE =
  'Úsala para revisar correos del usuario antes de responder o hacer seguimiento; no compartas su contenido fuera ' +
  'de la tarea.';

/**
 * Gmail completo: lectura (scope restringido gmail.readonly) y borradores/respuestas (gmail.compose). Va separado de
 * Gmail (envío) para que quien solo envía no tenga que conceder acceso a todo su correo.
 */
export const gmailInbox: CatalogEntry = {
  id: 'gmail-inbox',
  slug: GMAIL_INBOX,
  name: 'Gmail (bandeja y respuestas)',
  category: 'MENSAJERIA',
  description:
    'Buscar y leer correos, listar etiquetas, crear borradores, enviar correos y responder en hilos desde la ' +
    'cuenta de Gmail / Google Workspace del usuario (OAuth2).',
  icon: 'inbox',
  docsUrl: 'https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send',
  connectorType: 'REST',
  config: { baseUrl: 'https://gmail.googleapis.com' },
  auth: {
    oauth2_code: googleOAuth(GMAIL_INBOX, [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
    ]),
  },
  credentialFields: googleOwnAppFields,
  operations: [
    SEND_EMAIL,
    {
      key: 'search_messages',
      name: 'Buscar correos',
      description:
        'Busca correos con la sintaxis del buscador de Gmail (from:, to:, subject:, after:2026/10/01, is:unread, ' +
        'label:) y devuelve solo sus ids e hilos; usa get_message para leer cada uno. ' +
        READ_NOTE,
      write: false,
      inputSchema: {
        type: 'object',
        properties: {
          q: {
            type: 'string',
            maxLength: 1000,
            description: 'Consulta como en el buscador de Gmail, ej. "from:ana@acme.com after:2026/10/01"',
          },
          labelIds: {
            type: 'string',
            pattern: '^[A-Za-z0-9_-]{1,100}$',
            description: 'Solo correos con esta etiqueta (id de list_labels, ej. "INBOX", "UNREAD")',
          },
          maxResults: { type: 'integer', minimum: 1, maximum: 500, description: 'Máximo por página (por defecto 100)' },
          pageToken: { type: 'string', maxLength: 1000, description: 'nextPageToken de la respuesta anterior' },
          includeSpamTrash: { type: 'boolean', description: 'Incluir Spam y Papelera (por defecto no)' },
        },
      },
      definition: {
        method: 'GET',
        path: '/gmail/v1/users/me/messages',
        query: {
          q: '{{ input.q }}',
          labelIds: '{{ input.labelIds }}',
          maxResults: '{{ input.maxResults }}',
          pageToken: '{{ input.pageToken }}',
          includeSpamTrash: '{{ input.includeSpamTrash }}',
        },
      },
      verified: true,
      docsUrl: `${REF}/users.messages/list`,
    },
    {
      key: 'get_message',
      name: 'Leer correo',
      description:
        'Obtiene un correo por id. format=metadata (por defecto) devuelve cabeceras (From, To, Subject, Date, ' +
        'Message-ID, References), etiquetas, threadId y un extracto; format=full agrega el cuerpo (partes en ' +
        'base64url). Usa metadata para responder en un hilo y full solo si necesitas el texto completo. ' +
        READ_NOTE,
      write: false,
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: gmailId('Id del correo (de search_messages)'),
          format: {
            type: 'string',
            enum: ['metadata', 'full', 'minimal'],
            description: 'metadata (cabeceras), full (con cuerpo) o minimal (solo ids y etiquetas)',
          },
        },
      },
      definition: {
        method: 'GET',
        path: '/gmail/v1/users/me/messages/{{ input.id }}',
        query: { format: "{{ input.format | default:'metadata' }}" },
      },
      verified: true,
      docsUrl: `${REF}/users.messages/get`,
    },
    {
      key: 'list_labels',
      name: 'Listar etiquetas',
      description:
        'Lista las etiquetas del buzón (del sistema como INBOX, UNREAD, SENT y las creadas por el usuario) con su ' +
        'id. Úsala para obtener el id de una etiqueta antes de filtrar búsquedas por ella.',
      write: false,
      inputSchema: { type: 'object', properties: {} },
      definition: { method: 'GET', path: '/gmail/v1/users/me/labels' },
      verified: true,
      docsUrl: `${REF}/users.labels/list`,
    },
    {
      key: 'create_draft',
      name: 'Crear borrador',
      description:
        `Guarda un correo nuevo como borrador en Gmail, sin enviarlo ${WRITE_NOTICE}. Úsala cuando el usuario ` +
        'quiera revisar el correo antes de enviarlo o cuando no haya instrucción explícita de envío.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['to', 'subject', 'body'],
        properties: { to, subject, body, contentType },
      },
      definition: {
        method: 'POST',
        path: '/upload/gmail/v1/users/me/drafts',
        query: { uploadType: 'media' },
        headers: { 'content-type': 'message/rfc822' },
        bodyType: 'text',
        body: NEW_MESSAGE,
      },
      verified: false,
      docsUrl: `${REF}/users.drafts/create`,
    },
    {
      key: 'create_reply_draft',
      name: 'Crear borrador de respuesta',
      description:
        `Guarda como borrador una respuesta dentro de un hilo existente, sin enviarla ${WRITE_NOTICE}. Úsala para ` +
        'proponer respuestas que el usuario revisará. Obtén threadId y las cabeceras Message-ID/References del ' +
        'último correo del hilo con get_message (format=metadata).',
      write: true,
      inputSchema: replySchema,
      definition: {
        method: 'POST',
        path: '/upload/gmail/v1/users/me/drafts',
        query: { uploadType: 'multipart' },
        headers: multipartHeaders,
        bodyType: 'text',
        body: multipart('{"message":{"threadId":"{{ input.threadId }}"}}'),
      },
      verified: false,
      docsUrl: `${REF}/users.drafts/create`,
    },
    {
      key: 'reply_in_thread',
      name: 'Responder en un hilo',
      description:
        `Envía una respuesta dentro de un hilo de Gmail existente ${WRITE_NOTICE}. Úsala solo cuando el usuario o ` +
        'el flujo pidan responder explícitamente; si no, usa create_reply_draft. Obtén threadId y las cabeceras ' +
        'Message-ID/References del último correo del hilo con get_message (format=metadata).',
      write: true,
      inputSchema: replySchema,
      definition: {
        method: 'POST',
        path: '/upload/gmail/v1/users/me/messages/send',
        query: { uploadType: 'multipart' },
        headers: multipartHeaders,
        bodyType: 'text',
        body: multipart('{"threadId":"{{ input.threadId }}"}'),
      },
      verified: false,
      docsUrl: 'https://developers.google.com/workspace/gmail/api/guides/sending#threads',
    },
  ],
  verified: false,
  verificationNotes:
    'Carga simple (uploadType=media, Content-Type message/rfc822) a /upload/gmail/v1/users/me/messages/send y alcance ' +
    'gmail.send verificados en developers.google.com. Sin verificar: la aceptación de asuntos con caracteres no ASCII ' +
    'sin codificación RFC 2047 (el motor de plantillas no codifica); probar con asuntos con tildes antes de producción. ' +
    'Operaciones nuevas verificadas contra el documento de descubrimiento oficial de Gmail API v1 ' +
    '(gmail.googleapis.com/$discovery/rest?version=v1): messages.list (q, labelIds, maxResults<=500), messages.get ' +
    '(format minimal|full|raw|metadata), labels.list, drafts.create (carga simple a /upload/gmail/v1/users/me/drafts ' +
    'que acepta message/*), threadId y requisitos de hilo (threadId en Message/Draft.message, cabeceras ' +
    'In-Reply-To/References según RFC 2822 y asunto coincidente) y scopes por método. create_draft queda sin ' +
    'verificar por la misma salvedad de asuntos no ASCII; create_reply_draft y reply_in_thread usan ' +
    'uploadType=multipart (multipart/related: metadatos JSON + message/rfc822), formato del protocolo de carga de ' +
    'Google no descrito en el documento de descubrimiento ni contrastado con la guía (no accesible desde el entorno). ' +
    'Scopes: gmail.send (envío), gmail.readonly (buscar, leer, etiquetas) y gmail.compose (borradores y respuestas). ' +
    'Según Google gmail.send es sensible y gmail.readonly/gmail.compose son restringidos: la app OAuth de la ' +
    'plataforma necesita verificación de scopes restringidos y evaluación de seguridad anual (CASA) para usarlos en ' +
    'producción (confirmar en Google Cloud).',
};

/** Gmail solo envío (scope sensible gmail.send): la opción por defecto para seguimientos y confirmaciones. */
export const gmail: CatalogEntry = {
  id: 'gmail',
  slug: GMAIL,
  name: 'Gmail (envío)',
  category: 'MENSAJERIA',
  description: 'Enviar correos desde la cuenta de Gmail / Google Workspace del usuario (OAuth2, solo envío).',
  icon: 'inbox',
  docsUrl: 'https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send',
  connectorType: 'REST',
  config: { baseUrl: 'https://gmail.googleapis.com' },
  auth: { oauth2_code: googleOAuth(GMAIL, ['https://www.googleapis.com/auth/gmail.send']) },
  credentialFields: googleOwnAppFields,
  operations: [SEND_EMAIL],
  verified: false,
  verificationNotes:
    'Carga simple (uploadType=media, Content-Type message/rfc822) a /upload/gmail/v1/users/me/messages/send y alcance ' +
    'gmail.send verificados en developers.google.com. Sin verificar: la aceptación de asuntos con caracteres no ASCII ' +
    'sin codificación RFC 2047 (el motor de plantillas no codifica); probar con asuntos con tildes antes de producción. ' +
    'Para leer, buscar, crear borradores o responder en hilos instale Gmail (bandeja y respuestas).',
};
