import { OAUTH_PROVIDERS } from '../../../oauth/oauth.providers';
import { PATTERNS, secretRef, WRITE_NOTICE, type CatalogEntry } from '../catalog.types';
import { MICROSOFT_CLIENT_ID_HINT, MICROSOFT_CLIENT_SECRET_HINT } from './microsoft-graph';

const SLUG = 'OUTLOOK';

const dateTimeSchema = (what: string) => ({
  type: 'string',
  description: `${what} en hora local sin zona, ej. "2026-11-05T15:00:00" (la zona va en timeZone)`,
});

export const microsoftOutlook: CatalogEntry = {
  id: 'microsoft-outlook',
  slug: SLUG,
  name: 'Microsoft 365 Outlook',
  category: 'PRODUCTIVIDAD',
  description: 'Enviar correos y crear eventos de calendario en Outlook / Microsoft 365 (Microsoft Graph, OAuth2).',
  icon: 'calendar',
  docsUrl: 'https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0',
  connectorType: 'REST',
  config: { baseUrl: 'https://graph.microsoft.com/v1.0' },
  auth: {
    oauth2_code: {
      type: 'oauth2_code',
      provider: 'microsoft',
      authorizeUrl: OAUTH_PROVIDERS.microsoft.authorizeUrl,
      tokenUrl: OAUTH_PROVIDERS.microsoft.tokenUrl,
      scopes: ['offline_access', 'User.Read', 'Mail.Send', 'Calendars.ReadWrite'],
      clientIdRef: secretRef(SLUG, 'clientId'),
      clientSecretRef: secretRef(SLUG, 'clientSecret'),
      accountLabel: { url: 'https://graph.microsoft.com/v1.0/me', path: 'userPrincipalName' },
    },
  },
  credentialFields: [
    {
      key: 'clientId',
      label: 'Application (client) ID de Entra ID (app propia, opcional)',
      secret: false,
      required: false,
      authMethods: ['oauth2_code'],
      pattern: PATTERNS.guid,
      invalidHint: MICROSOFT_CLIENT_ID_HINT,
      help: 'Vacío = app OAuth de la plataforma Nexo.',
    },
    {
      key: 'clientSecret',
      label: 'Client secret (app propia, opcional)',
      secret: true,
      required: false,
      authMethods: ['oauth2_code'],
      pattern: PATTERNS.notGuid,
      invalidHint: MICROSOFT_CLIENT_SECRET_HINT,
    },
  ],
  operations: [
    {
      key: 'send_email',
      name: 'Enviar correo',
      description:
        `Envía un correo desde el buzón de Outlook conectado y guarda copia en Enviados ${WRITE_NOTICE}. Úsala solo ` +
        'cuando el usuario o el flujo lo pidan explícitamente; revisa destinatario y contenido antes.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['to', 'subject', 'body'],
        properties: {
          to: { type: 'string', format: 'email', description: 'Correo del destinatario' },
          subject: { type: 'string', pattern: PATTERNS.singleLine, description: 'Asunto' },
          body: { type: 'string', description: 'Cuerpo del mensaje' },
          contentType: { type: 'string', enum: ['Text', 'HTML'], description: 'Formato del cuerpo (por defecto Text)' },
        },
      },
      definition: {
        method: 'POST',
        path: '/me/sendMail',
        body: {
          message: {
            subject: '{{ input.subject }}',
            body: { contentType: "{{ input.contentType | default:'Text' }}", content: '{{ input.body }}' },
            toRecipients: [{ emailAddress: { address: '{{ input.to }}' } }],
          },
          saveToSentItems: true,
        },
      },
      verified: true,
      docsUrl: 'https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0',
    },
    {
      key: 'create_event',
      name: 'Crear evento de calendario',
      description:
        `Crea un evento en el calendario predeterminado del usuario y envía invitaciones a los asistentes ` +
        `${WRITE_NOTICE}. Úsala para agendar reuniones confirmadas; opcionalmente con enlace de Teams.`,
      write: true,
      inputSchema: {
        type: 'object',
        required: ['subject', 'start', 'end'],
        properties: {
          subject: { type: 'string', description: 'Título del evento' },
          start: dateTimeSchema('Inicio'),
          end: dateTimeSchema('Fin'),
          timeZone: {
            type: 'string',
            description: 'Zona horaria (IANA o Windows), ej. "America/Bogota"; por defecto UTC',
          },
          description: { type: 'string', description: 'Descripción o agenda (HTML permitido)' },
          location: { type: 'string', description: 'Lugar' },
          attendees: {
            type: 'array',
            description:
              'Asistentes: [{ "emailAddress": { "address": "ana@acme.com", "name": "Ana" }, "type": "required" }]',
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
          },
          isOnlineMeeting: { type: 'boolean', description: 'true = crear reunión de Teams' },
        },
      },
      definition: {
        method: 'POST',
        path: '/me/events',
        body: {
          subject: '{{ input.subject }}',
          body: { contentType: 'HTML', content: "{{ input.description | default:'' }}" },
          start: { dateTime: '{{ input.start }}', timeZone: "{{ input.timeZone | default:'UTC' }}" },
          end: { dateTime: '{{ input.end }}', timeZone: "{{ input.timeZone | default:'UTC' }}" },
          location: { displayName: "{{ input.location | default:'' }}" },
          attendees: '{{ input.attendees }}',
          isOnlineMeeting: '{{ input.isOnlineMeeting }}',
        },
      },
      verified: true,
      docsUrl: 'https://learn.microsoft.com/en-us/graph/api/calendar-post-events?view=graph-rest-1.0',
    },
  ],
  verified: true,
  verificationNotes:
    'POST /me/sendMail (Mail.Send, saveToSentItems) y POST /me/events (start/end con dateTime + timeZone, attendees) ' +
    'según learn.microsoft.com; OAuth v2.0 con PKCE S256 y offline_access para el refresh token según la ' +
    'documentación de Microsoft identity platform. Tenant "common" (cuentas personales y de organización).',
};
