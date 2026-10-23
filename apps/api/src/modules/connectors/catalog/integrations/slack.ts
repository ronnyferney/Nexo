import { secretRef, WRITE_NOTICE, type CatalogEntry } from '../catalog.types';

const SLACK = 'SLACK';
const SLACK_DOCS = 'https://docs.slack.dev/reference/methods/chat.postMessage/';

export const slack: CatalogEntry = {
  id: 'slack',
  slug: SLACK,
  name: 'Slack',
  category: 'MENSAJERIA',
  description: 'Publicar mensajes en canales de Slack con un token de bot.',
  icon: 'bell',
  docsUrl: SLACK_DOCS,
  connectorType: 'REST',
  config: { baseUrl: 'https://slack.com/api' },
  auth: { bearer: { type: 'bearer', token: secretRef(SLACK, 'botToken') } },
  credentialFields: [
    {
      key: 'botToken',
      label: 'Token de bot (xoxb-...)',
      secret: true,
      required: true,
      help: 'api.slack.com/apps → OAuth & Permissions → Bot User OAuth Token (alcance chat:write; invite el bot al canal).',
    },
  ],
  operations: [
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
  ],
  verified: true,
  verificationNotes:
    'POST https://slack.com/api/chat.postMessage con Authorization Bearer xoxb, cuerpo JSON (channel, text, thread_ts) ' +
    'y alcance chat:write según docs.slack.dev.',
};
