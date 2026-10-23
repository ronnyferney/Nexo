import { WRITE_NOTICE, type CatalogEntry, type CatalogOperation } from '../catalog.types';
import { googleOAuth, googleOwnAppFields } from './google-oauth';

const CALENDAR = 'GOOGLE_CALENDAR';
const REF = 'https://developers.google.com/workspace/calendar/api/v3/reference';

/**
 * Id de calendario: "primary", un correo o "<id>@group.calendar.google.com". Se admite "@" (válido en un segmento de
 * ruta) pero no "/", "?", "#" ni espacios: los calendarios con "#" (festivos) quedan fuera a propósito.
 */
const calendarId = {
  type: 'string',
  pattern: '^[A-Za-z0-9_.@+-]{1,254}$',
  description: 'Id del calendario: "primary" (calendario principal del usuario) o el id devuelto por list_calendars',
};
/** Id de evento (base32hex; las instancias de eventos recurrentes llevan sufijo "_20261105T150000Z"). */
const eventId = {
  type: 'string',
  pattern: '^[A-Za-z0-9_-]{1,1024}$',
  description: 'Id del evento (campo "id" devuelto por list_events o create_event)',
};
/** Marca de tiempo RFC 3339 con zona obligatoria (lo exige events.list y freeBusy.query). */
const rfc3339 = (what: string) => ({
  type: 'string',
  format: 'date-time',
  description: `${what} en RFC 3339 con zona, ej. "2026-11-05T09:00:00-05:00" o "2026-11-05T14:00:00Z"`,
});
const timeZone = {
  type: 'string',
  pattern: '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,3}$',
  description: 'Zona horaria IANA, ej. "America/Bogota"',
};
/** EventDateTime: dateTime (con o sin desfase si se envía timeZone) o date para eventos de día completo. */
const eventDateTime = (what: string) => ({
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  description: `${what}: { "dateTime": "2026-11-05T15:00:00", "timeZone": "America/Bogota" } o { "date": "2026-11-05" }`,
  properties: {
    dateTime: {
      type: 'string',
      pattern: String.raw`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?$`,
      description: 'Fecha y hora RFC 3339; sin desfase exige timeZone',
    },
    date: { type: 'string', format: 'date', description: 'Fecha "aaaa-mm-dd" (evento de día completo)' },
    timeZone,
  },
});
const attendees = {
  type: 'array',
  maxItems: 100,
  description: 'Invitados, ej. [{ "email": "ana@acme.com" }, { "email": "luis@acme.com", "optional": true }]',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['email'],
    properties: {
      email: { type: 'string', format: 'email' },
      displayName: { type: 'string', maxLength: 200 },
      optional: { type: 'boolean' },
    },
  },
};
const sendUpdates = {
  type: 'string',
  enum: ['all', 'externalOnly', 'none'],
  description: 'A quién notificar por correo: all (todos), externalOnly (solo invitados sin Google Calendar), none',
};
const eventFields = {
  summary: { type: 'string', maxLength: 1024, description: 'Título del evento' },
  description: { type: 'string', maxLength: 8000, description: 'Descripción (admite HTML)' },
  location: { type: 'string', maxLength: 1024, description: 'Ubicación en texto libre' },
  start: eventDateTime('Inicio (inclusivo)'),
  end: eventDateTime('Fin (exclusivo)'),
  attendees,
};
/** Cuerpo Event: las claves con un valor ausente se omiten al serializar a JSON. */
const eventBody = {
  summary: '{{ input.summary }}',
  description: '{{ input.description }}',
  location: '{{ input.location }}',
  start: '{{ input.start }}',
  end: '{{ input.end }}',
  attendees: '{{ input.attendees }}',
};

/**
 * `requestId` de conferenceData.createRequest: el cliente lo genera y debe ser único por evento (si se repite, Google
 * ignora la solicitud). El motor de plantillas no genera UUID, así que se pide como entrada con un patrón estricto;
 * reintentar con el mismo valor es idempotente (no crea una segunda reunión).
 */
export const MEET_REQUEST_ID_PATTERN = '^[A-Za-z0-9_-]{8,64}$';

const createEventBase = {
  required: ['calendarId', 'summary', 'start', 'end'],
  properties: { calendarId, ...eventFields, sendUpdates },
};

const createEvent: CatalogOperation = {
  key: 'create_event',
  name: 'Crear evento',
  description:
    `Crea un evento en un calendario de Google Calendar ${WRITE_NOTICE}. Úsala para agendar reuniones o recordatorios ` +
    'cuando el usuario lo pida; consulta antes la disponibilidad (check_availability) si hay invitados. Para incluir ' +
    'un enlace de Google Meet usa create_event_with_meet. Con sendUpdates=all los invitados reciben la invitación.',
  write: true,
  inputSchema: { type: 'object', ...createEventBase },
  definition: {
    method: 'POST',
    path: '/calendars/{{ input.calendarId }}/events',
    query: { sendUpdates: '{{ input.sendUpdates }}' },
    body: eventBody,
  },
  verified: true,
  docsUrl: `${REF}/events/insert`,
};

const createEventWithMeet: CatalogOperation = {
  key: 'create_event_with_meet',
  name: 'Crear evento con Google Meet',
  description:
    `Crea un evento en Google Calendar con un enlace de videollamada de Google Meet nuevo ${WRITE_NOTICE}. Úsala ` +
    'para agendar reuniones virtuales. meetRequestId debe ser un valor nuevo por cada evento (p. ej. "nexo-" + ' +
    'fecha y hora + iniciales); repetirlo en un reintento no duplica la reunión. El enlace queda en hangoutLink y en ' +
    'conferenceData.entryPoints; si conferenceData.createRequest.status.statusCode es "pending", consulta el ' +
    'evento con get_event más tarde.',
  write: true,
  inputSchema: {
    type: 'object',
    required: [...createEventBase.required, 'meetRequestId'],
    properties: {
      ...createEventBase.properties,
      meetRequestId: {
        type: 'string',
        pattern: MEET_REQUEST_ID_PATTERN,
        description: 'Id único de la solicitud de reunión (8-64 caracteres: letras, números, "_" o "-")',
      },
    },
  },
  definition: {
    method: 'POST',
    path: '/calendars/{{ input.calendarId }}/events',
    query: { conferenceDataVersion: 1, sendUpdates: '{{ input.sendUpdates }}' },
    body: {
      ...eventBody,
      conferenceData: {
        createRequest: {
          requestId: '{{ input.meetRequestId }}',
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    },
  },
  verified: true,
  docsUrl: 'https://developers.google.com/workspace/calendar/api/guides/create-events#conferencing',
};

export const googleCalendar: CatalogEntry = {
  id: 'google-calendar',
  slug: CALENDAR,
  name: 'Google Calendar',
  category: 'PRODUCTIVIDAD',
  description:
    'Consultar calendarios, eventos y disponibilidad, y crear, modificar o cancelar eventos (con Google Meet ' +
    'opcional) en Google Calendar con la cuenta del usuario (OAuth2).',
  icon: 'calendar',
  docsUrl: REF,
  connectorType: 'REST',
  config: { baseUrl: 'https://www.googleapis.com/calendar/v3' },
  auth: {
    oauth2_code: googleOAuth(CALENDAR, [
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.events.freebusy',
    ]),
  },
  credentialFields: googleOwnAppFields,
  operations: [
    {
      key: 'list_calendars',
      name: 'Listar calendarios',
      description:
        'Lista los calendarios a los que está suscrito el usuario (id, nombre, zona horaria, rol de acceso). Úsala ' +
        'para obtener el calendarId de un calendario distinto del principal ("primary").',
      write: false,
      inputSchema: {
        type: 'object',
        properties: {
          minAccessRole: {
            type: 'string',
            enum: ['freeBusyReader', 'reader', 'writer', 'owner'],
            description: 'Rol mínimo del usuario (writer = calendarios donde puede crear eventos)',
          },
          maxResults: { type: 'integer', minimum: 1, maximum: 250, description: 'Máximo por página (por defecto 100)' },
          pageToken: { type: 'string', maxLength: 1000, description: 'nextPageToken de la respuesta anterior' },
        },
      },
      definition: {
        method: 'GET',
        path: '/users/me/calendarList',
        query: {
          minAccessRole: '{{ input.minAccessRole }}',
          maxResults: '{{ input.maxResults }}',
          pageToken: '{{ input.pageToken }}',
        },
      },
      verified: true,
      docsUrl: `${REF}/calendarList/list`,
    },
    {
      key: 'list_events',
      name: 'Listar eventos',
      description:
        'Lista los eventos de un calendario en un rango de fechas, ordenados por inicio y con los eventos ' +
        'recurrentes expandidos en instancias. Úsala para revisar la agenda, buscar una reunión por texto (q) u ' +
        'obtener el id de un evento antes de modificarlo o cancelarlo.',
      write: false,
      inputSchema: {
        type: 'object',
        required: ['calendarId', 'timeMin', 'timeMax'],
        properties: {
          calendarId,
          timeMin: rfc3339('Desde (eventos que terminan después de este instante)'),
          timeMax: rfc3339('Hasta (eventos que empiezan antes de este instante)'),
          q: { type: 'string', maxLength: 500, description: 'Texto libre: título, descripción, lugar o invitados' },
          maxResults: {
            type: 'integer',
            minimum: 1,
            maximum: 2500,
            description: 'Máximo por página (por defecto 250)',
          },
          timeZone: { ...timeZone, description: 'Zona horaria de la respuesta (por defecto la del calendario)' },
          pageToken: { type: 'string', maxLength: 1000, description: 'nextPageToken de la respuesta anterior' },
        },
      },
      definition: {
        method: 'GET',
        path: '/calendars/{{ input.calendarId }}/events',
        query: {
          timeMin: '{{ input.timeMin }}',
          timeMax: '{{ input.timeMax }}',
          singleEvents: true,
          orderBy: 'startTime',
          q: '{{ input.q }}',
          maxResults: '{{ input.maxResults }}',
          timeZone: '{{ input.timeZone }}',
          pageToken: '{{ input.pageToken }}',
        },
      },
      verified: true,
      docsUrl: `${REF}/events/list`,
    },
    {
      key: 'get_event',
      name: 'Consultar evento',
      description:
        'Obtiene un evento por id con todos sus datos (invitados y sus respuestas, enlace de Meet, estado). Úsala ' +
        'para confirmar los detalles de una reunión o recuperar el enlace de Meet de un evento recién creado.',
      write: false,
      inputSchema: {
        type: 'object',
        required: ['calendarId', 'eventId'],
        properties: { calendarId, eventId, timeZone: { ...timeZone, description: 'Zona horaria de la respuesta' } },
      },
      definition: {
        method: 'GET',
        path: '/calendars/{{ input.calendarId }}/events/{{ input.eventId }}',
        query: { timeZone: '{{ input.timeZone }}' },
      },
      verified: true,
      docsUrl: `${REF}/events/get`,
    },
    {
      key: 'check_availability',
      name: 'Consultar disponibilidad',
      description:
        'Devuelve los intervalos ocupados (busy) de uno o varios calendarios en un rango, sin ver el contenido de los ' +
        'eventos. Úsala antes de proponer o agendar una reunión para encontrar un horario libre común.',
      write: false,
      inputSchema: {
        type: 'object',
        required: ['timeMin', 'timeMax', 'items'],
        properties: {
          timeMin: rfc3339('Inicio del intervalo'),
          timeMax: rfc3339('Fin del intervalo'),
          timeZone: { ...timeZone, description: 'Zona horaria de la respuesta (por defecto UTC)' },
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            description: 'Calendarios a consultar, ej. [{ "id": "primary" }, { "id": "ana@acme.com" }]',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id'],
              properties: { id: { type: 'string', maxLength: 254 } },
            },
          },
        },
      },
      definition: {
        method: 'POST',
        path: '/freeBusy',
        body: {
          timeMin: '{{ input.timeMin }}',
          timeMax: '{{ input.timeMax }}',
          timeZone: '{{ input.timeZone }}',
          items: '{{ input.items }}',
        },
      },
      verified: true,
      docsUrl: `${REF}/freebusy/query`,
    },
    createEvent,
    createEventWithMeet,
    {
      key: 'update_event',
      name: 'Actualizar evento',
      description:
        `Modifica solo los campos enviados de un evento existente (título, horario, lugar, invitados) ${WRITE_NOTICE}. ` +
        'Úsala para reprogramar o ajustar una reunión. attendees reemplaza la lista completa de invitados: incluye ' +
        'a los actuales que deban seguir. Usa sendUpdates=all para avisar del cambio.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['calendarId', 'eventId'],
        minProperties: 3,
        properties: { calendarId, eventId, ...eventFields, sendUpdates },
      },
      definition: {
        method: 'PATCH',
        path: '/calendars/{{ input.calendarId }}/events/{{ input.eventId }}',
        query: { sendUpdates: '{{ input.sendUpdates }}' },
        body: eventBody,
      },
      verified: true,
      docsUrl: `${REF}/events/patch`,
    },
    {
      key: 'delete_event',
      name: 'Cancelar evento',
      description:
        `Cancela y elimina un evento del calendario ${WRITE_NOTICE}. Úsala solo cuando el usuario pida cancelar una ` +
        'reunión concreta; confirma antes el id con list_events o get_event. Con sendUpdates=all los invitados ' +
        'reciben la cancelación.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['calendarId', 'eventId'],
        properties: { calendarId, eventId, sendUpdates },
      },
      definition: {
        method: 'DELETE',
        path: '/calendars/{{ input.calendarId }}/events/{{ input.eventId }}',
        query: { sendUpdates: '{{ input.sendUpdates }}' },
      },
      verified: true,
      docsUrl: `${REF}/events/delete`,
    },
  ],
  verified: true,
  verificationNotes:
    'Rutas, métodos, parámetros (timeMin/timeMax RFC 3339 con zona, singleEvents, orderBy=startTime, q, ' +
    'maxResults, sendUpdates all|externalOnly|none, conferenceDataVersion=1), cuerpos Event/FreeBusyRequest, ' +
    'conferenceData.createRequest (requestId generado por el cliente; si se repite, la solicitud se ignora; ' +
    'conferenceSolutionKey.type=hangoutsMeet) y scopes aceptados por cada método verificados contra el documento de ' +
    'descubrimiento oficial de Calendar API v3 (www.googleapis.com/discovery/v1/apis/calendar/v3/rest), fuente de la ' +
    'referencia de developers.google.com. Scopes mínimos: calendar.calendarlist.readonly (list_calendars), ' +
    'calendar.events (eventos) y calendar.events.freebusy (disponibilidad). Sin verificar en la documentación (no ' +
    'accesible desde el entorno): la clasificación de los scopes; según Google los de Calendar son sensibles, por lo ' +
    'que la app OAuth de producción requiere verificación de scopes sensibles (confirmar en la pantalla de ' +
    'consentimiento de Google Cloud). El enlace de Meet depende de que la cuenta y la política del administrador de Workspace permitan Meet; ' +
    'la creación de la conferencia es asíncrona (statusCode pending|success|failure). Limitaciones: los calendarios ' +
    'con "#" en el id (p. ej. festivos) no se aceptan; update_event no agrega Meet a un evento existente.',
};
