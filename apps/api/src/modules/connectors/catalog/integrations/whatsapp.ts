import { secretRef, WRITE_NOTICE, type CatalogEntry } from '../catalog.types';

const WA = 'WHATSAPP';
const WA_DOCS = 'https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages/';
/** Versión de la Graph API (Meta mantiene cada versión ~2 años). */
export const WHATSAPP_GRAPH_VERSION = 'v23.0';

const waRecipient = {
  type: 'string',
  pattern: '^\\+?[0-9]{6,20}$',
  description: 'Número del destinatario en formato internacional, solo dígitos (ej. 573001234567)',
};

export const whatsapp: CatalogEntry = {
  id: 'whatsapp',
  slug: WA,
  name: 'WhatsApp Business (Cloud API)',
  category: 'MENSAJERIA',
  description: 'Enviar mensajes de plantilla y de texto por WhatsApp Business Cloud API de Meta.',
  icon: 'send',
  docsUrl: WA_DOCS,
  connectorType: 'REST',
  config: { baseUrl: `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}` },
  auth: { bearer: { type: 'bearer', token: secretRef(WA, 'accessToken') } },
  credentialFields: [
    {
      key: 'accessToken',
      label: 'Token de acceso (usuario del sistema)',
      secret: true,
      required: true,
      help: 'Meta Business → Usuarios del sistema → token permanente con whatsapp_business_messaging.',
    },
    {
      key: 'phoneNumberId',
      label: 'Phone number ID',
      secret: false,
      required: true,
      pattern: '^[0-9]{5,30}$',
      help: 'WhatsApp Manager / App de Meta → WhatsApp → Configuración de la API.',
    },
  ],
  operations: [
    {
      key: 'send_template',
      name: 'Enviar plantilla de WhatsApp',
      description:
        `Envía un mensaje de plantilla aprobada por Meta a un número de WhatsApp ${WRITE_NOTICE}. Es la única forma ` +
        'de iniciar una conversación o escribir fuera de la ventana de 24 h desde el último mensaje del cliente.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['to', 'templateName'],
        properties: {
          to: waRecipient,
          templateName: { type: 'string', description: 'Nombre exacto de la plantilla aprobada' },
          languageCode: { type: 'string', description: 'Idioma de la plantilla (ej. "es", "es_MX"; por defecto "es")' },
          components: {
            type: 'array',
            description:
              'Variables de la plantilla, ej. [{ "type": "body", "parameters": [{ "type": "text", "text": "Ana" }] }]',
            items: { type: 'object' },
          },
        },
      },
      definition: {
        method: 'POST',
        path: `/${secretRef(WA, 'phoneNumberId')}/messages`,
        body: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '{{ input.to }}',
          type: 'template',
          template: {
            name: '{{ input.templateName }}',
            language: { code: "{{ input.languageCode | default:'es' }}" },
            components: '{{ input.components }}',
          },
        },
      },
      verified: true,
      docsUrl: WA_DOCS,
    },
    {
      key: 'send_text',
      name: 'Enviar texto por WhatsApp',
      description:
        `Envía un mensaje de texto libre por WhatsApp ${WRITE_NOTICE}. Solo funciona dentro de la ventana de 24 h ` +
        'desde el último mensaje del cliente; fuera de ella usa "Enviar plantilla de WhatsApp".',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['to', 'text'],
        properties: {
          to: waRecipient,
          text: { type: 'string', minLength: 1, maxLength: 4096, description: 'Texto del mensaje' },
          previewUrl: { type: 'boolean', description: 'Mostrar vista previa de enlaces' },
        },
      },
      definition: {
        method: 'POST',
        path: `/${secretRef(WA, 'phoneNumberId')}/messages`,
        body: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '{{ input.to }}',
          type: 'text',
          text: { body: '{{ input.text }}', preview_url: '{{ input.previewUrl }}' },
        },
      },
      verified: true,
      docsUrl: WA_DOCS,
    },
  ],
  verified: true,
  verificationNotes:
    'POST /{versión}/{phone-number-id}/messages con Bearer, messaging_product "whatsapp", type template (name, ' +
    'language.code, components) y type text (text.body) según developers.facebook.com. Versión de Graph fijada en ' +
    `${WHATSAPP_GRAPH_VERSION}; revisar periódicamente.`,
};
