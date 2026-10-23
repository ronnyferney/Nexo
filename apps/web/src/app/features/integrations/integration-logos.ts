import { siGmail, siGooglecalendar, siGooglemeet, siGooglesheets, siHubspot, siWhatsapp } from 'simple-icons';

/**
 * Logos de marca del catálogo de integraciones: único punto de mapeo id-de-catálogo → logo.
 *
 * - `simple-icons` (CC0-1.0, versión fijada en package.json): glifo oficial de un solo color con el `hex` de la marca.
 *   Se importan solo los íconos usados para que el resto del paquete quede fuera del bundle.
 * - Marcas que no están en simple-icons (Microsoft, Slack, LinkedIn, Salesforce...): SVG propio y simple con los
 *   colores oficiales, en un lienzo de 24×24.
 * - Entradas futuras sin logo: monograma con un color estable derivado del nombre (`brandLogo`).
 */

/** Forma geométrica de un logo propio: trazo (`d`), círculo o rectángulo, con su color de relleno. */
export type LogoShape =
  | { d: string; fill: string }
  | { cx: number; cy: number; r: number; fill: string }
  | { x: number; y: number; w: number; h: number; rx?: number; fill: string };

export type BrandLogo =
  | { kind: 'shapes'; title: string; shapes: LogoShape[] }
  | { kind: 'monogram'; title: string; text: string; color: string };

interface SimpleIconLike {
  title: string;
  path: string;
  hex: string;
}

const fromSimpleIcon = (i: SimpleIconLike): BrandLogo => ({
  kind: 'shapes',
  title: i.title,
  shapes: [{ d: i.path, fill: `#${i.hex}` }],
});

const monogram = (title: string, text: string, color: string): BrandLogo => ({ kind: 'monogram', title, text, color });

/** Cuatro cuadrados de Microsoft con sus colores oficiales. */
const MICROSOFT: BrandLogo = {
  kind: 'shapes',
  title: 'Microsoft 365',
  shapes: [
    { x: 1, y: 1, w: 10.5, h: 10.5, fill: '#F25022' },
    { x: 12.5, y: 1, w: 10.5, h: 10.5, fill: '#7FBA00' },
    { x: 1, y: 12.5, w: 10.5, h: 10.5, fill: '#00A4EF' },
    { x: 12.5, y: 12.5, w: 10.5, h: 10.5, fill: '#FFB900' },
  ],
};

/** Outlook: sobre azul con la «O» sobre la placa frontal. */
const OUTLOOK: BrandLogo = {
  kind: 'shapes',
  title: 'Microsoft Outlook',
  shapes: [
    { x: 8, y: 4, w: 15, h: 16, rx: 2, fill: '#28A8EA' },
    { d: 'M8 11l7.5 5L23 11v7a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z', fill: '#0364B8' },
    { x: 1, y: 6, w: 12, h: 12, rx: 2, fill: '#0078D4' },
    { cx: 7, cy: 12, r: 3.6, fill: '#FFFFFF' },
    { cx: 7, cy: 12, r: 2.1, fill: '#0078D4' },
  ],
};

/** Teams: placa morada con la «T» y la silueta de equipo. */
const TEAMS: BrandLogo = {
  kind: 'shapes',
  title: 'Microsoft Teams',
  shapes: [
    { cx: 19, cy: 6.5, r: 2.6, fill: '#5059C9' },
    { x: 15, y: 10, w: 8, h: 9, rx: 3, fill: '#5059C9' },
    { cx: 12.5, cy: 5, r: 3.2, fill: '#7B83EB' },
    { x: 7, y: 9, w: 11, h: 12, rx: 4, fill: '#7B83EB' },
    { x: 1, y: 6, w: 12, h: 12, rx: 2, fill: '#4B53BC' },
    { d: 'M3.6 9h6.8v1.9H8v5.4H6v-5.4H3.6z', fill: '#FFFFFF' },
  ],
};

/** To Do: marca de verificación en dos tonos de azul. */
const TODO: BrandLogo = {
  kind: 'shapes',
  title: 'Microsoft To Do',
  shapes: [
    { d: 'M1.5 12.6l2.6-2.6 5.4 5.4-2.6 2.6z', fill: '#195ABD' },
    { d: 'M6.9 18l-2.6-2.6L17.6 2.1l2.6 2.6z', fill: '#2987E6' },
    { d: 'M17.6 2.1l2.6 2.6 2.3-2.3c-.7-.7-1.9-.7-2.6 0z', fill: '#3CCBF4' },
  ],
};

/** Planner: placa verde con columnas de tablero. */
const PLANNER: BrandLogo = {
  kind: 'shapes',
  title: 'Microsoft Planner',
  shapes: [
    { x: 1.5, y: 2, w: 21, h: 20, rx: 3, fill: '#31752F' },
    { x: 5, y: 6, w: 3.6, h: 12, rx: 1, fill: '#FFFFFF' },
    { x: 10.2, y: 6, w: 3.6, h: 8, rx: 1, fill: '#C3E6B8' },
    { x: 15.4, y: 6, w: 3.6, h: 10, rx: 1, fill: '#FFFFFF' },
  ],
};

/** Slack: almohadilla de cuatro colores. */
const SLACK: BrandLogo = {
  kind: 'shapes',
  title: 'Slack',
  shapes: [
    {
      d: 'M5.04 15.17a2.53 2.53 0 0 1-2.52 2.52A2.53 2.53 0 0 1 0 15.17a2.53 2.53 0 0 1 2.52-2.52h2.52zm1.27 0a2.53 2.53 0 0 1 2.52-2.52 2.53 2.53 0 0 1 2.52 2.52v6.31A2.53 2.53 0 0 1 8.83 24a2.53 2.53 0 0 1-2.52-2.52z',
      fill: '#E01E5A',
    },
    {
      d: 'M8.83 5.04a2.53 2.53 0 0 1-2.52-2.52A2.53 2.53 0 0 1 8.83 0a2.53 2.53 0 0 1 2.52 2.52v2.52zm0 1.27a2.53 2.53 0 0 1 2.52 2.52 2.53 2.53 0 0 1-2.52 2.52H2.52A2.53 2.53 0 0 1 0 8.83a2.53 2.53 0 0 1 2.52-2.52z',
      fill: '#36C5F0',
    },
    {
      d: 'M18.96 8.83a2.53 2.53 0 0 1 2.52-2.52A2.53 2.53 0 0 1 24 8.83a2.53 2.53 0 0 1-2.52 2.52h-2.52zm-1.27 0a2.53 2.53 0 0 1-2.52 2.52 2.53 2.53 0 0 1-2.52-2.52V2.52A2.53 2.53 0 0 1 15.17 0a2.53 2.53 0 0 1 2.52 2.52z',
      fill: '#2EB67D',
    },
    {
      d: 'M15.17 18.96a2.53 2.53 0 0 1 2.52 2.52A2.53 2.53 0 0 1 15.17 24a2.53 2.53 0 0 1-2.52-2.52v-2.52zm0-1.27a2.53 2.53 0 0 1-2.52-2.52 2.53 2.53 0 0 1 2.52-2.52h6.31A2.53 2.53 0 0 1 24 15.17a2.53 2.53 0 0 1-2.52 2.52z',
      fill: '#ECB22E',
    },
  ],
};

/** LinkedIn: «in» blanca sobre la placa azul oficial. */
const LINKEDIN: BrandLogo = {
  kind: 'shapes',
  title: 'LinkedIn',
  shapes: [
    { x: 1, y: 1, w: 22, h: 22, rx: 3, fill: '#0A66C2' },
    { cx: 6.9, cy: 6.9, r: 1.9, fill: '#FFFFFF' },
    { x: 5.3, y: 9.6, w: 3.2, h: 9.6, fill: '#FFFFFF' },
    {
      d: 'M10.6 9.6h3.05v1.33h.05c.43-.8 1.46-1.63 3-1.63 3.2 0 3.8 2.1 3.8 4.85v5.05h-3.2v-4.5c0-1.07-.02-2.45-1.5-2.45-1.5 0-1.73 1.17-1.73 2.37v4.58H10.6z',
      fill: '#FFFFFF',
    },
  ],
};

/** Salesforce: nube azul. */
const SALESFORCE: BrandLogo = {
  kind: 'shapes',
  title: 'Salesforce',
  shapes: [
    { cx: 9.6, cy: 9.6, r: 4.4, fill: '#00A1E0' },
    { cx: 15.4, cy: 8.8, r: 4.6, fill: '#00A1E0' },
    { cx: 19.4, cy: 13, r: 4, fill: '#00A1E0' },
    { cx: 13.6, cy: 15.6, r: 4.3, fill: '#00A1E0' },
    { cx: 5.6, cy: 13.6, r: 4, fill: '#00A1E0' },
    { x: 5.6, y: 10, w: 13.8, h: 7, fill: '#00A1E0' },
  ],
};

const LUSHA = monogram('Lusha', 'L', '#6A3CF2');

/** Mapa id-de-catálogo → logo. Agregar una integración nueva = una línea aquí (o se usa el monograma). */
const LOGOS: Record<string, BrandLogo> = {
  gmail: fromSimpleIcon(siGmail),
  'gmail-inbox': fromSimpleIcon(siGmail),
  'google-calendar': fromSimpleIcon(siGooglecalendar),
  'google-meet': fromSimpleIcon(siGooglemeet),
  'google-sheets': fromSimpleIcon(siGooglesheets),
  hubspot: fromSimpleIcon(siHubspot),
  whatsapp: fromSimpleIcon(siWhatsapp),
  slack: SLACK,
  linkedin: LINKEDIN,
  salesforce: SALESFORCE,
  pipedrive: monogram('Pipedrive', 'p', '#017737'),
  lusha: LUSHA,
  'lusha-mcp': LUSHA,
  'microsoft-outlook': OUTLOOK,
  'microsoft-mail': OUTLOOK,
  'microsoft-calendar': MICROSOFT,
  'microsoft-teams': TEAMS,
  'microsoft-todo': TODO,
  'microsoft-planner': PLANNER,
};

/** Proveedor de identidad mostrado en «Iniciar sesión con…» (por prefijo de id; si no, el nombre de la entrada). */
const OAUTH_PROVIDERS: [RegExp, string][] = [
  [/^(google-|gmail)/, 'Google'],
  [/^microsoft-/, 'Microsoft'],
  [/^hubspot/, 'HubSpot'],
];

/** Paleta de monogramas para entradas sin logo registrado (contraste AA con texto blanco). */
const FALLBACK_COLORS = ['#4F46E5', '#0E7490', '#B45309', '#BE185D', '#047857', '#6D28D9', '#1D4ED8'];

export function brandLogo(entry: { id: string; name: string }): BrandLogo {
  const known = LOGOS[entry.id];
  if (known) return known;
  const name = entry.name.trim() || entry.id;
  let hash = 0;
  for (const ch of entry.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return monogram(name, name.charAt(0).toUpperCase(), FALLBACK_COLORS[hash % FALLBACK_COLORS.length]);
}

export function oauthProvider(entry: { id: string; name: string }): string {
  return OAUTH_PROVIDERS.find(([re]) => re.test(entry.id))?.[1] ?? entry.name.replace(/\s*\(.*\)\s*$/, '');
}
