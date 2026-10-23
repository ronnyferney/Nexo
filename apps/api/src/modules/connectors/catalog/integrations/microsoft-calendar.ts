import { PATTERNS, WRITE_NOTICE, type CatalogEntry } from '../catalog.types';
import {
  dateTimeTimeZoneSchema,
  GRAPH_BASE_URL,
  graphDocs,
  graphIdSchema,
  graphResourceDocs,
  microsoftAppCredentialFields,
  microsoftGraphAuth,
  preferTimeZoneHeader,
  timeZoneSchema,
} from './microsoft-graph';

const SLUG = 'MS_CALENDAR';
const SCOPES = ['Calendars.ReadWrite', 'Calendars.Read.Shared'];

const localDateTime = (what: string) => ({
  type: 'string',
  minLength: 10,
  maxLength: 40,
  description: `${what} en hora local sin zona, ej. "2026-11-05T15:00:00" (la zona va en timeZone)`,
});

const attendeesSchema = (extra: string) => ({
  type: 'array',
  maxItems: 100,
  description: `Asistentes: [{ "emailAddress": { "address": "ana@acme.com", "name": "Ana" }, "type": "required" }]. ${extra}`,
  items: {
    type: 'object',
    required: ['emailAddress'],
    properties: {
      emailAddress: {
        type: 'object',
        required: ['address'],
        properties: { address: { type: 'string', format: 'email' }, name: { type: 'string' } },
      },
      type: { type: 'string', enum: ['required', 'optional', 'resource'] },
    },
  },
});

const onlineMeetingProviderSchema = {
  type: 'string',
  enum: ['teamsForBusiness', 'skypeForBusiness', 'skypeForConsumer'],
  description:
    'Proveedor de la reunión en línea: "teamsForBusiness" para Microsoft Teams (junto con isOnlineMeeting=true)',
};

const eventIdSchema = graphIdSchema('Id del evento (campo "id" de "Listar eventos en un rango")');

export const microsoftCalendar: CatalogEntry = {
  id: 'microsoft-calendar',
  slug: SLUG,
  name: 'Calendario corporativo (Microsoft 365)',
  category: 'PRODUCTIVIDAD',
  description:
    'Consultar la agenda, la disponibilidad de personas y sugerir horarios; crear, mover y cancelar reuniones (con ' +
    'Teams) en el calendario de Outlook de una cuenta de trabajo o escuela de Microsoft 365 (Microsoft Graph, OAuth2).',
  icon: 'calendar',
  docsUrl: graphResourceDocs('calendar-overview'),
  connectorType: 'REST',
  config: { baseUrl: GRAPH_BASE_URL },
  auth: microsoftGraphAuth(SLUG, SCOPES),
  credentialFields: microsoftAppCredentialFields(`User.Read, ${SCOPES.join(', ')} (más offline_access)`),
  operations: [
    {
      key: 'list_calendars',
      name: 'Listar calendarios',
      description:
        'Lista los calendarios del usuario conectado (nombre, id, si es el predeterminado, si puede editarlo y su ' +
        'propietario). Úsala para saber qué calendarios existen; las demás operaciones usan el calendario predeterminado.',
      write: false,
      inputSchema: { type: 'object', properties: {} },
      definition: { method: 'GET', path: '/me/calendars' },
      verified: true,
      docsUrl: graphDocs('user-list-calendars'),
    },
    {
      key: 'list_events',
      name: 'Listar eventos en un rango',
      description:
        'Lista los eventos (incluidas las ocurrencias de series) del calendario predeterminado entre dos fechas, ' +
        'ordenados por inicio. Úsala para revisar la agenda de un día o semana, buscar huecos propios u obtener el id ' +
        'de un evento antes de actualizarlo o cancelarlo.',
      write: false,
      inputSchema: {
        type: 'object',
        required: ['startDateTime', 'endDateTime'],
        properties: {
          startDateTime: {
            type: 'string',
            minLength: 10,
            maxLength: 40,
            description:
              'Inicio del rango en ISO 8601 con desfase, ej. "2026-11-05T00:00:00-05:00" (sin desfase = UTC)',
          },
          endDateTime: {
            type: 'string',
            minLength: 10,
            maxLength: 40,
            description: 'Fin del rango en ISO 8601 con desfase, ej. "2026-11-06T00:00:00-05:00"',
          },
          timeZone: timeZoneSchema('Zona horaria en la que se devuelven las horas de los eventos'),
          top: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: 'Máximo de eventos a devolver (por defecto 50)',
          },
        },
      },
      definition: {
        method: 'GET',
        path: '/me/calendarView',
        query: {
          startDateTime: '{{ input.startDateTime }}',
          endDateTime: '{{ input.endDateTime }}',
          $select:
            'id,subject,start,end,location,organizer,attendees,isAllDay,isCancelled,isOnlineMeeting,onlineMeeting,showAs,webLink',
          $orderby: 'start/dateTime',
          $top: '{{ input.top | default:50 }}',
        },
        headers: preferTimeZoneHeader,
      },
      verified: true,
      docsUrl: graphDocs('user-list-calendarview'),
    },
    {
      key: 'get_schedule',
      name: 'Consultar disponibilidad de personas',
      description:
        'Devuelve la disponibilidad libre/ocupado (y los bloques ocupados) de personas, listas de distribución o salas ' +
        'de la organización en un período. Úsala antes de proponer una reunión para ver cuándo están libres los ' +
        'asistentes. Solo cuentas de trabajo o escuela.',
      write: false,
      inputSchema: {
        type: 'object',
        required: ['schedules', 'start', 'end'],
        properties: {
          schedules: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: { type: 'string', format: 'email' },
            description: 'Correos SMTP de personas, listas de distribución o salas, ej. ["ana@acme.com"]',
          },
          start: localDateTime('Inicio del período'),
          end: localDateTime('Fin del período'),
          timeZone: timeZoneSchema('Zona horaria de start/end y de la respuesta'),
          availabilityViewInterval: {
            type: 'integer',
            minimum: 5,
            maximum: 1440,
            description: 'Minutos por franja en availabilityView (por defecto 30)',
          },
        },
      },
      definition: {
        method: 'POST',
        path: '/me/calendar/getSchedule',
        headers: preferTimeZoneHeader,
        body: {
          schedules: '{{ input.schedules }}',
          startTime: { dateTime: '{{ input.start }}', timeZone: "{{ input.timeZone | default:'UTC' }}" },
          endTime: { dateTime: '{{ input.end }}', timeZone: "{{ input.timeZone | default:'UTC' }}" },
          availabilityViewInterval: '{{ input.availabilityViewInterval }}',
        },
      },
      verified: true,
      docsUrl: graphDocs('calendar-getschedule'),
    },
    {
      key: 'find_meeting_times',
      name: 'Sugerir horarios de reunión',
      description:
        'Sugiere horarios de reunión en una ventana de tiempo según la disponibilidad del organizador y de los ' +
        'asistentes (con nivel de confianza). Úsala cuando haya que encontrar un hueco común; si no hay sugerencias, ' +
        'revisa emptySuggestionsReason y amplía la ventana. Solo cuentas de trabajo o escuela.',
      write: false,
      inputSchema: {
        type: 'object',
        required: ['start', 'end'],
        properties: {
          attendees: attendeesSchema(
            'Las personas se tratan como "required"; salas como "resource". Vacío = solo el organizador.',
          ),
          start: localDateTime('Inicio de la ventana de búsqueda'),
          end: localDateTime('Fin de la ventana de búsqueda'),
          timeZone: timeZoneSchema('Zona horaria de la ventana y de la respuesta'),
          meetingDuration: {
            type: 'string',
            pattern: String.raw`^PT(?=\d)([0-9]{1,2}H)?([0-9]{1,4}M)?$`,
            description: 'Duración ISO 8601, ej. "PT30M", "PT1H", "PT1H30M" (por defecto 30 minutos)',
          },
          activityDomain: {
            type: 'string',
            enum: ['work', 'personal', 'unrestricted'],
            description:
              'work = horario laboral (por defecto); personal = incluye fines de semana; unrestricted = cualquier hora',
          },
          maxCandidates: { type: 'integer', minimum: 1, maximum: 20, description: 'Máximo de sugerencias' },
          minimumAttendeePercentage: {
            type: 'number',
            minimum: 0,
            maximum: 100,
            description: 'Confianza mínima (0-100) de asistencia; por defecto 50',
          },
          isOrganizerOptional: { type: 'boolean', description: 'true si el organizador no necesita asistir' },
        },
      },
      definition: {
        method: 'POST',
        path: '/me/findMeetingTimes',
        headers: preferTimeZoneHeader,
        body: {
          attendees: '{{ input.attendees }}',
          timeConstraint: {
            activityDomain: "{{ input.activityDomain | default:'work' }}",
            timeSlots: [
              {
                start: { dateTime: '{{ input.start }}', timeZone: "{{ input.timeZone | default:'UTC' }}" },
                end: { dateTime: '{{ input.end }}', timeZone: "{{ input.timeZone | default:'UTC' }}" },
              },
            ],
          },
          meetingDuration: '{{ input.meetingDuration }}',
          maxCandidates: '{{ input.maxCandidates }}',
          minimumAttendeePercentage: '{{ input.minimumAttendeePercentage }}',
          isOrganizerOptional: '{{ input.isOrganizerOptional }}',
          returnSuggestionReasons: true,
        },
      },
      verified: true,
      docsUrl: graphDocs('user-findmeetingtimes'),
    },
    {
      key: 'create_event',
      name: 'Crear evento o reunión',
      description:
        `Crea un evento en el calendario predeterminado y envía invitaciones a los asistentes ${WRITE_NOTICE}. Úsala ` +
        'para agendar reuniones confirmadas por el usuario; con isOnlineMeeting=true y onlineMeetingProvider=' +
        '"teamsForBusiness" genera el enlace de Teams (en la respuesta, onlineMeeting.joinUrl).',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['subject', 'start', 'end'],
        properties: {
          subject: { type: 'string', minLength: 1, maxLength: 255, description: 'Título del evento' },
          start: localDateTime('Inicio'),
          end: localDateTime('Fin'),
          timeZone: timeZoneSchema('Zona horaria de start/end y de la respuesta'),
          description: { type: 'string', description: 'Descripción o agenda (HTML permitido)' },
          location: { type: 'string', description: 'Lugar' },
          attendees: attendeesSchema('Reciben la invitación por correo.'),
          isOnlineMeeting: { type: 'boolean', description: 'true = reunión en línea (use onlineMeetingProvider)' },
          onlineMeetingProvider: onlineMeetingProviderSchema,
          transactionId: {
            type: 'string',
            pattern: PATTERNS.pathId,
            description:
              'Id propio opcional (p. ej. un GUID) para que Graph evite duplicados si la petición se reintenta',
          },
        },
      },
      definition: {
        method: 'POST',
        path: '/me/events',
        headers: preferTimeZoneHeader,
        body: {
          subject: '{{ input.subject }}',
          body: { contentType: 'HTML', content: "{{ input.description | default:'' }}" },
          start: { dateTime: '{{ input.start }}', timeZone: "{{ input.timeZone | default:'UTC' }}" },
          end: { dateTime: '{{ input.end }}', timeZone: "{{ input.timeZone | default:'UTC' }}" },
          location: { displayName: "{{ input.location | default:'' }}" },
          attendees: '{{ input.attendees }}',
          isOnlineMeeting: '{{ input.isOnlineMeeting }}',
          onlineMeetingProvider: '{{ input.onlineMeetingProvider }}',
          transactionId: '{{ input.transactionId }}',
        },
      },
      verified: true,
      docsUrl: graphDocs('user-post-events'),
    },
    {
      key: 'update_event',
      name: 'Actualizar evento',
      description:
        `Modifica un evento existente (título, horario, lugar, asistentes, reunión de Teams...) ${WRITE_NOTICE}. Solo ` +
        'se cambian los campos enviados; si el evento tiene asistentes, Outlook les notifica el cambio. Obtén el ' +
        'eventId con "Listar eventos en un rango". Ojo: attendees reemplaza la lista completa de asistentes.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['eventId'],
        properties: {
          eventId: eventIdSchema,
          subject: { type: 'string', minLength: 1, maxLength: 255, description: 'Nuevo título' },
          start: dateTimeTimeZoneSchema('Nuevo inicio'),
          end: dateTimeTimeZoneSchema('Nuevo fin'),
          body: {
            type: 'object',
            required: ['contentType', 'content'],
            description:
              'Nueva descripción: { "contentType": "HTML", "content": "<p>Agenda</p>" } (reemplaza la anterior)',
            properties: { contentType: { type: 'string', enum: ['Text', 'HTML'] }, content: { type: 'string' } },
          },
          location: {
            type: 'object',
            required: ['displayName'],
            description: 'Nuevo lugar: { "displayName": "Sala 3" }',
            properties: { displayName: { type: 'string' } },
          },
          attendees: attendeesSchema('Reemplaza la lista completa: incluya también a los asistentes actuales.'),
          isOnlineMeeting: { type: 'boolean', description: 'true = convertir en reunión en línea' },
          onlineMeetingProvider: onlineMeetingProviderSchema,
          importance: { type: 'string', enum: ['low', 'normal', 'high'], description: 'Importancia' },
          showAs: {
            type: 'string',
            enum: ['free', 'tentative', 'busy', 'oof', 'workingElsewhere', 'unknown'],
            description: 'Cómo se muestra el tiempo en la disponibilidad',
          },
        },
      },
      definition: {
        method: 'PATCH',
        path: '/me/events/{{ input.eventId }}',
        body: {
          subject: '{{ input.subject }}',
          start: '{{ input.start }}',
          end: '{{ input.end }}',
          body: '{{ input.body }}',
          location: '{{ input.location }}',
          attendees: '{{ input.attendees }}',
          isOnlineMeeting: '{{ input.isOnlineMeeting }}',
          onlineMeetingProvider: '{{ input.onlineMeetingProvider }}',
          importance: '{{ input.importance }}',
          showAs: '{{ input.showAs }}',
        },
      },
      verified: true,
      docsUrl: graphDocs('event-update'),
    },
    {
      key: 'cancel_event',
      name: 'Cancelar reunión',
      description:
        `Cancela una reunión organizada por el usuario conectado y envía la cancelación con un mensaje opcional a ` +
        `los asistentes ${WRITE_NOTICE}. Solo funciona si el usuario es el organizador (si no, Graph responde error). ` +
        'Úsala solo con confirmación explícita; obtén el eventId con "Listar eventos en un rango".',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['eventId'],
        properties: {
          eventId: eventIdSchema,
          comment: { type: 'string', maxLength: 2000, description: 'Mensaje para los asistentes (opcional)' },
        },
      },
      definition: {
        method: 'POST',
        path: '/me/events/{{ input.eventId }}/cancel',
        body: { comment: '{{ input.comment }}' },
      },
      verified: true,
      docsUrl: graphDocs('event-cancel'),
    },
  ],
  verified: true,
  verificationNotes:
    'Verificado contra el repositorio fuente de learn.microsoft.com (microsoftgraph/microsoft-graph-docs-contrib, ' +
    'api-reference/v1.0) y sus tablas de permisos: GET /me/calendars (Calendars.ReadBasic), GET /me/calendarView con ' +
    'startDateTime/endDateTime obligatorios y Prefer: outlook.timezone (Calendars.ReadBasic), POST ' +
    '/me/calendar/getSchedule (Calendars.ReadBasic; no admite cuentas personales), POST /me/findMeetingTimes ' +
    '(Calendars.Read.Shared; no admite cuentas personales), POST /me/events con isOnlineMeeting + ' +
    'onlineMeetingProvider "teamsForBusiness" y PATCH /me/events/{id} (Calendars.ReadWrite), POST ' +
    '/me/events/{id}/cancel (Calendars.ReadWrite, solo el organizador, 202 sin cuerpo). Calendars.ReadWrite cubre ' +
    'los permisos ReadBasic. Ningún permiso delegado requiere consentimiento de administrador, salvo que la ' +
    'política del tenant bloquee el consentimiento de usuarios.',
};
