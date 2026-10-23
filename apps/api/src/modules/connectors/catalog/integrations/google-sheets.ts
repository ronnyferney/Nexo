import { WRITE_NOTICE, type CatalogEntry } from '../catalog.types';
import { googleOAuth, googleOwnAppFields } from './google-oauth';

const SHEETS = 'GOOGLE_SHEETS';
const SHEETS_DOCS = 'https://developers.google.com/workspace/sheets/api/reference/rest';

const spreadsheetId = {
  type: 'string',
  pattern: '^[A-Za-z0-9_-]{10,200}$',
  description: 'Id de la hoja de cálculo (el segmento entre /d/ y /edit en la URL)',
};
const range = {
  type: 'string',
  pattern: String.raw`^[^/?#\\\r\n]{1,200}$`,
  description: 'Rango en notación A1, ej. "Leads!A1:F200" o "Leads" para toda la pestaña',
};

export const googleSheets: CatalogEntry = {
  id: 'google-sheets',
  slug: SHEETS,
  name: 'Google Sheets',
  category: 'PRODUCTIVIDAD',
  description: 'Leer y agregar filas en hojas de cálculo de Google con la cuenta del usuario (OAuth2).',
  icon: 'table',
  docsUrl: SHEETS_DOCS,
  connectorType: 'REST',
  config: { baseUrl: 'https://sheets.googleapis.com/v4' },
  auth: { oauth2_code: googleOAuth(SHEETS, ['https://www.googleapis.com/auth/spreadsheets']) },
  credentialFields: googleOwnAppFields,
  operations: [
    {
      key: 'read_range',
      name: 'Leer rango',
      description:
        'Lee los valores de un rango de una hoja de Google Sheets (filas como arreglos). Úsala para consultar listas ' +
        'de leads, precios u otros datos tabulares mantenidos en una hoja.',
      write: false,
      inputSchema: {
        type: 'object',
        required: ['spreadsheetId', 'range'],
        properties: {
          spreadsheetId,
          range,
          valueRenderOption: {
            type: 'string',
            enum: ['FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA'],
            description: 'Cómo devolver los valores (por defecto FORMATTED_VALUE)',
          },
        },
      },
      definition: {
        method: 'GET',
        path: '/spreadsheets/{{ input.spreadsheetId }}/values/{{ input.range }}',
        query: { valueRenderOption: '{{ input.valueRenderOption }}' },
      },
      verified: true,
      docsUrl: 'https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get',
    },
    {
      key: 'append_rows',
      name: 'Agregar filas',
      description:
        `Agrega filas al final de la tabla de un rango de Google Sheets ${WRITE_NOTICE}. Úsala para registrar leads, ` +
        'resultados o bitácoras. Cada fila es un arreglo de valores en el orden de las columnas.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['spreadsheetId', 'range', 'values'],
        properties: {
          spreadsheetId,
          range: { ...range, description: 'Rango que identifica la tabla, ej. "Leads!A1" o "Leads"' },
          values: {
            type: 'array',
            minItems: 1,
            description: 'Filas a agregar, ej. [["Ana", "ana@acme.com", 120]]',
            items: { type: 'array', items: { type: ['string', 'number', 'boolean', 'null'] } },
          },
          valueInputOption: {
            type: 'string',
            enum: ['USER_ENTERED', 'RAW'],
            description: 'USER_ENTERED (por defecto) interpreta fechas/fórmulas como si las escribiera un usuario',
          },
        },
      },
      definition: {
        method: 'POST',
        path: '/spreadsheets/{{ input.spreadsheetId }}/values/{{ input.range }}:append',
        query: {
          valueInputOption: "{{ input.valueInputOption | default:'USER_ENTERED' }}",
          insertDataOption: 'INSERT_ROWS',
        },
        body: { values: '{{ input.values }}' },
      },
      verified: true,
      docsUrl: 'https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append',
    },
  ],
  verified: true,
  verificationNotes:
    'spreadsheets.values.get/append (valueInputOption obligatorio, insertDataOption INSERT_ROWS) según ' +
    'developers.google.com. OAuth web server (access_type=offline, prompt=consent) y revocación en ' +
    'oauth2.googleapis.com/revoke según la guía oficial.',
};
