import { PATTERNS, WRITE_NOTICE, type CatalogEntry } from '../catalog.types';
import { googleOAuth, googleOwnAppFields } from './google-oauth';

const GMAIL = 'GMAIL';

export const gmail: CatalogEntry = {
  id: 'gmail',
  slug: GMAIL,
  name: 'Gmail',
  category: 'MENSAJERIA',
  description: 'Enviar correos desde la cuenta de Gmail / Google Workspace del usuario (OAuth2, solo envío).',
  icon: 'inbox',
  docsUrl: 'https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send',
  connectorType: 'REST',
  config: { baseUrl: 'https://gmail.googleapis.com' },
  auth: { oauth2_code: googleOAuth(GMAIL, ['https://www.googleapis.com/auth/gmail.send']) },
  credentialFields: googleOwnAppFields,
  operations: [
    {
      key: 'send_email',
      name: 'Enviar correo',
      description:
        `Envía un correo desde la cuenta de Gmail conectada ${WRITE_NOTICE}. Úsala solo cuando el usuario o el ` +
        'flujo lo indiquen explícitamente (seguimientos, confirmaciones). Revisa destinatario y contenido antes.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['to', 'subject', 'body'],
        properties: {
          to: {
            type: 'string',
            pattern: PATTERNS.singleLine,
            description: 'Destinatario(s), separados por coma: "ana@acme.com, Luis <luis@acme.com>"',
          },
          subject: { type: 'string', pattern: PATTERNS.singleLine, maxLength: 250, description: 'Asunto' },
          body: { type: 'string', description: 'Cuerpo del mensaje' },
          contentType: {
            type: 'string',
            enum: ['text/plain', 'text/html'],
            description: 'Formato del cuerpo (por defecto text/plain)',
          },
        },
      },
      definition: {
        method: 'POST',
        path: '/upload/gmail/v1/users/me/messages/send',
        query: { uploadType: 'media' },
        headers: { 'content-type': 'message/rfc822' },
        bodyType: 'text',
        body:
          'To: {{ input.to }}\r\nSubject: {{ input.subject }}\r\nMIME-Version: 1.0\r\n' +
          "Content-Type: {{ input.contentType | default:'text/plain' }}; charset=UTF-8\r\n" +
          'Content-Transfer-Encoding: 8bit\r\n\r\n{{ input.body }}',
      },
      verified: false,
      docsUrl: 'https://developers.google.com/workspace/gmail/api/guides/uploads',
    },
  ],
  verified: false,
  verificationNotes:
    'Carga simple (uploadType=media, Content-Type message/rfc822) a /upload/gmail/v1/users/me/messages/send y alcance ' +
    'gmail.send verificados en developers.google.com. Sin verificar: la aceptación de asuntos con caracteres no ASCII ' +
    'sin codificación RFC 2047 (el motor de plantillas no codifica); probar con asuntos con tildes antes de producción.',
};
