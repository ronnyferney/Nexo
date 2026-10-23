import { WRITE_NOTICE, type CatalogEntry } from '../catalog.types';
import { googleOAuth, googleOwnAppFields } from './google-oauth';

const MEET = 'GOOGLE_MEET';
const REF = 'https://developers.google.com/workspace/meet/api/reference/rest/v2';

/** Ids generados por Meet (sin "/": se pide solo el último segmento del nombre del recurso). */
const resourceId = (description: string) => ({ type: 'string', pattern: '^[A-Za-z0-9_-]{1,200}$', description });
const conferenceRecordId = resourceId(
  'Id del registro de conferencia: lo que va después de "conferenceRecords/" en el campo name de list_conference_records',
);
const pageToken = { type: 'string', maxLength: 1000, description: 'nextPageToken de la respuesta anterior' };
const pageSize = (max: number, byDefault: number) => ({
  type: 'integer',
  minimum: 1,
  maximum: max,
  description: `Máximo de resultados por página (por defecto ${byDefault}, máximo ${max})`,
});

export const googleMeet: CatalogEntry = {
  id: 'google-meet',
  slug: MEET,
  name: 'Google Meet',
  category: 'PRODUCTIVIDAD',
  description:
    'Crear salas de Google Meet y consultar reuniones pasadas: asistentes y transcripciones (Meet REST API v2, ' +
    'OAuth2 del usuario).',
  icon: 'users',
  docsUrl: 'https://developers.google.com/workspace/meet/api/guides/overview',
  connectorType: 'REST',
  config: { baseUrl: 'https://meet.googleapis.com/v2' },
  auth: {
    oauth2_code: googleOAuth(MEET, [
      'https://www.googleapis.com/auth/meetings.space.created',
      'https://www.googleapis.com/auth/meetings.space.readonly',
    ]),
  },
  credentialFields: googleOwnAppFields,
  operations: [
    {
      key: 'create_space',
      name: 'Crear sala de reunión',
      description:
        `Crea una sala de Google Meet y devuelve su enlace (meetingUri) y código (meetingCode) ${WRITE_NOTICE}. Úsala ` +
        'cuando se necesite un enlace de videollamada inmediato sin evento de calendario; para agendar una reunión ' +
        'con invitados usa Google Calendar con Meet.',
      write: true,
      inputSchema: {
        type: 'object',
        properties: {
          accessType: {
            type: 'string',
            enum: ['OPEN', 'TRUSTED', 'RESTRICTED'],
            description:
              'Quién entra sin pedir permiso: OPEN (cualquiera con el enlace), TRUSTED (la organización e ' +
              'invitados), RESTRICTED (solo invitados). Por defecto, la política del usuario/administrador',
          },
        },
      },
      definition: { method: 'POST', path: '/spaces', body: { config: { accessType: '{{ input.accessType }}' } } },
      verified: true,
      docsUrl: `${REF}/spaces/create`,
    },
    {
      key: 'get_space',
      name: 'Consultar sala',
      description:
        'Obtiene una sala de Meet por su id o por su código de reunión ("abc-mnop-xyz"): enlace, configuración y ' +
        'conferencia activa. Úsala para obtener el nombre de la sala (spaces/...) y filtrar sus registros.',
      write: false,
      inputSchema: {
        type: 'object',
        required: ['space'],
        properties: {
          space: {
            type: 'string',
            pattern: '^[A-Za-z0-9_-]{1,128}$',
            description: 'Id de la sala (después de "spaces/") o código de reunión, ej. "abc-mnop-xyz"',
          },
        },
      },
      definition: { method: 'GET', path: '/spaces/{{ input.space }}' },
      verified: true,
      docsUrl: `${REF}/spaces/get`,
    },
    {
      key: 'list_conference_records',
      name: 'Listar reuniones realizadas',
      description:
        'Lista los registros de conferencias (reuniones que ya ocurrieron o están en curso) en las que participó el ' +
        'usuario, de la más reciente a la más antigua. Úsala para encontrar una reunión y luego consultar sus ' +
        'asistentes o transcripciones. Los registros se eliminan 30 días después de terminar la reunión.',
      write: false,
      inputSchema: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            pattern: String.raw`^[^\r\n]{1,500}$`,
            description:
              'Filtro opcional sobre space.meeting_code, space.name, start_time o end_time, ej. ' +
              '\'space.meeting_code = "abc-mnop-xyz"\' o ' +
              '\'start_time>="2026-11-01T00:00:00Z" AND start_time<="2026-11-02T00:00:00Z"\'',
          },
          pageSize: pageSize(100, 25),
          pageToken,
        },
      },
      definition: {
        method: 'GET',
        path: '/conferenceRecords',
        query: { filter: '{{ input.filter }}', pageSize: '{{ input.pageSize }}', pageToken: '{{ input.pageToken }}' },
      },
      verified: true,
      docsUrl: `${REF}/conferenceRecords/list`,
    },
    {
      key: 'list_participants',
      name: 'Listar asistentes de una reunión',
      description:
        'Lista los participantes de una conferencia (usuario, hora de primera entrada y última salida). Úsala para ' +
        'saber quién asistió a una reunión; filter "latest_end_time IS NULL" devuelve solo los que siguen conectados.',
      write: false,
      inputSchema: {
        type: 'object',
        required: ['conferenceRecordId'],
        properties: {
          conferenceRecordId,
          filter: {
            type: 'string',
            pattern: String.raw`^[^\r\n]{1,300}$`,
            description: 'Filtro opcional sobre earliest_start_time o latest_end_time, ej. "latest_end_time IS NULL"',
          },
          pageSize: pageSize(250, 100),
          pageToken,
        },
      },
      definition: {
        method: 'GET',
        path: '/conferenceRecords/{{ input.conferenceRecordId }}/participants',
        query: { filter: '{{ input.filter }}', pageSize: '{{ input.pageSize }}', pageToken: '{{ input.pageToken }}' },
      },
      verified: true,
      docsUrl: `${REF}/conferenceRecords.participants/list`,
    },
    {
      key: 'list_transcripts',
      name: 'Listar transcripciones de una reunión',
      description:
        'Lista las transcripciones generadas en una conferencia (estado y documento de Google Docs asociado). Úsala ' +
        'para saber si una reunión tiene transcripción antes de leer su contenido con list_transcript_entries.',
      write: false,
      inputSchema: {
        type: 'object',
        required: ['conferenceRecordId'],
        properties: { conferenceRecordId, pageSize: pageSize(100, 10), pageToken },
      },
      definition: {
        method: 'GET',
        path: '/conferenceRecords/{{ input.conferenceRecordId }}/transcripts',
        query: { pageSize: '{{ input.pageSize }}', pageToken: '{{ input.pageToken }}' },
      },
      verified: true,
      docsUrl: `${REF}/conferenceRecords.transcripts/list`,
    },
    {
      key: 'list_transcript_entries',
      name: 'Leer transcripción',
      description:
        'Devuelve las intervenciones de una transcripción en orden cronológico (participante, texto, idioma y ' +
        'horas). Úsala para resumir una reunión, extraer acuerdos o tareas; pagina con pageToken en reuniones largas.',
      write: false,
      inputSchema: {
        type: 'object',
        required: ['conferenceRecordId', 'transcriptId'],
        properties: {
          conferenceRecordId,
          transcriptId: resourceId('Id de la transcripción: lo que va después de "transcripts/" en list_transcripts'),
          pageSize: pageSize(100, 10),
          pageToken,
        },
      },
      definition: {
        method: 'GET',
        path: '/conferenceRecords/{{ input.conferenceRecordId }}/transcripts/{{ input.transcriptId }}/entries',
        query: { pageSize: '{{ input.pageSize }}', pageToken: '{{ input.pageToken }}' },
      },
      verified: true,
      docsUrl: `${REF}/conferenceRecords.transcripts.entries/list`,
    },
  ],
  // Endpoints verificados; los requisitos de licencia y la clasificación de scopes no se pudieron confirmar.
  verified: false,
  verificationNotes:
    'Rutas, métodos, parámetros (filter, pageSize con sus máximos, pageToken), cuerpo Space.config.accessType y los ' +
    'scopes aceptados por cada método verificados contra el documento de descubrimiento oficial de Meet REST API ' +
    'v2 (meet.googleapis.com/$discovery/rest?version=v2). Scopes: meetings.space.created (crear salas y leer las ' +
    'creadas por la app) y meetings.space.readonly (leer registros, asistentes y transcripciones de cualquier ' +
    'reunión del usuario; sin él solo se ven las salas creadas por la app). Sin verificar en developers.google.com ' +
    '(no accesible desde el entorno): según Google, meetings.space.created es sensible y meetings.space.readonly ' +
    'es restringido, lo que exige verificación de la app OAuth y posiblemente una evaluación de seguridad antes de ' +
    'producción (confirmar en la pantalla de consentimiento de Google Cloud). Requisitos (sin verificar): las ' +
    'transcripciones solo existen si la reunión se transcribió, función disponible solo en ciertas ediciones ' +
    'de pago de Google Workspace; las cuentas personales pueden no tener acceso a artefactos. Verificado: los ' +
    'registros de conferencia se borran 30 días después de terminar y el scope readonly cubre las conferencias ' +
    '"del usuario" (no las de toda la organización).',
};
