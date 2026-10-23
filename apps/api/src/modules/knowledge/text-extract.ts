/**
 * Extracción de texto plano para la ingesta de conocimiento. Funciones puras y seguras: no ejecutan ni interpretan
 * HTML, solo eliminan etiquetas (con su contenido en script/style/noscript/template/svg) y decodifican entidades.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  iexcl: '¡',
  iquest: '¿',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  euro: '€',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  bull: '•',
  deg: '°',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  ntilde: 'ñ',
  Ntilde: 'Ñ',
  uuml: 'ü',
  Uuml: 'Ü',
};

/** Decodifica entidades HTML básicas en una sola pasada (evita la doble decodificación de `&amp;lt;`). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, (match, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[ref] ?? NAMED_ENTITIES[ref.toLowerCase()] ?? match;
  });
}

/** Título del documento HTML (`<title>`), si existe. */
export function htmlTitle(html: string): string | null {
  const m = /<title\b[^>]*>([\s\S]{0,2000}?)<\/title\s*>/i.exec(html);
  const title = m
    ? decodeEntities(m[1].replace(/<[^>]*>/g, ''))
        .replace(/\s+/g, ' ')
        .trim()
    : '';
  return title || null;
}

/** Convierte HTML a texto plano conservando párrafos y saltos de línea razonables. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(
      /<\/?(p|div|section|article|header|footer|main|aside|nav|ul|ol|table|blockquote|pre|h[1-6])\b[^>]*>/gi,
      '\n\n',
    )
    .replace(/<(li|tr|dt|dd|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(li|tr|dt|dd)\s*>/gi, '')
    .replace(/<\/?(td|th)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    // Restos de "<" sin cerrar no deben convertirse en etiquetas al decodificar: se decodifica al final.
    .replace(/[<>]/g, ' ');
  return decodeEntities(text)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const ALLOWED_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.html'] as const;

export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i).toLowerCase() : '';
}

/** Texto plano de un archivo subido según su extensión. Lanza si no es texto UTF-8 utilizable. */
export function fileToText(filename: string, buffer: Buffer): string {
  const raw = buffer.toString('utf8').replace(/^\uFEFF/, '');
  if (raw.includes('\u0000')) throw new Error('El archivo no parece ser de texto');
  const ext = extensionOf(filename);
  if (ext === '.html' || ext === '.htm') return htmlToText(raw);
  if (ext === '.json') {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      throw new Error('El archivo JSON no es válido');
    }
  }
  return raw;
}
