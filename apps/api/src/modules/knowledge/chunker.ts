/**
 * Fragmentación de documentos para la base de conocimiento (ADR 0003, D4). Función pura: corta en fragmentos de
 * ~`size` caracteres con `overlap` de solapamiento, prefiriendo límites de párrafo, luego de frase, luego de línea y
 * por último de palabra. Nunca devuelve fragmentos vacíos y siempre avanza (no hay bucles infinitos).
 */
export interface ChunkOptions {
  size?: number;
  overlap?: number;
}

export const CHUNK_SIZE = 1200;
export const CHUNK_OVERLAP = 150;

/** Normaliza saltos de línea y espacios sin perder la estructura de párrafos. */
export function normalizeText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Mejor punto de corte en `text[min, max]` (índice exclusivo del fragmento). */
function findBreak(text: string, min: number, max: number): number {
  const window = text.slice(min, max);
  const paragraph = window.lastIndexOf('\n\n');
  if (paragraph >= 0) return min + paragraph + 2;
  let sentence = -1;
  const re = /[.!?…;:](?=\s)/g;
  for (let m = re.exec(window); m; m = re.exec(window)) sentence = m.index + 1;
  if (sentence > 0) return min + sentence;
  const line = window.lastIndexOf('\n');
  if (line >= 0) return min + line + 1;
  const space = window.lastIndexOf(' ');
  if (space >= 0) return min + space + 1;
  return max;
}

export function chunkText(input: string, options: ChunkOptions = {}): string[] {
  const size = Math.max(options.size ?? CHUNK_SIZE, 50);
  const overlap = Math.min(Math.max(options.overlap ?? CHUNK_OVERLAP, 0), Math.floor(size / 3));
  const text = normalizeText(input);
  if (!text) return [];
  if (text.length <= size) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const hardEnd = Math.min(start + size, text.length);
    const end = hardEnd >= text.length ? text.length : findBreak(text, start + Math.floor(size / 2), hardEnd);
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break;

    // El siguiente fragmento arranca `overlap` caracteres antes del corte, alineado al inicio de una palabra.
    let next = Math.max(end - overlap, start + 1);
    if (next > 0 && !/\s/.test(text[next - 1])) {
      const ws = text.slice(next, end).search(/\s/);
      if (ws >= 0) next += ws + 1;
    }
    start = next;
  }
  return chunks;
}
