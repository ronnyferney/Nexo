import { Pipe, type PipeTransform } from '@angular/core';

/**
 * Convierte un subconjunto seguro de Markdown a HTML para mostrar las respuestas del agente (tablas, listas,
 * encabezados, negritas, código). El texto puede contener contenido no confiable (cuerpos de correo), por lo que:
 * 1) todo el texto se escapa primero (nunca se interpreta HTML del contenido), y
 * 2) solo se emiten etiquetas de una lista blanca.
 * El resultado se enlaza con `[innerHTML]`, que Angular vuelve a sanear como segunda capa de defensa.
 *
 * No pretende cubrir todo Markdown: cubre lo que generan los agentes (encabezados `#`..`####`, `**negrita**`,
 * `*cursiva*`, `` `código` ``, bloques ```` ``` ````, listas `-`/`1.`, tablas `| … |`, enlaces `[t](url)`, líneas).
 */
@Pipe({ name: 'markdown', standalone: true })
export class MarkdownPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '';
    return render(value);
  }
}

/** Escapa los caracteres que tienen significado en HTML: el contenido nunca se interpreta como etiquetas. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Solo se enlazan URLs http(s) o mailto; cualquier otra cosa (javascript:, data:) se deja como texto. */
function safeHref(url: string): string | null {
  const u = url.trim();
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : null;
}

/** Formato en línea sobre texto YA escapado: negrita, cursiva, código y enlaces. */
function inline(escaped: string): string {
  let out = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Enlaces [texto](url): el texto ya viene escapado; se valida el esquema de la URL.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text: string, url: string) => {
    const href = safeHref(url.replace(/&amp;/g, '&'));
    return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>` : m;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  return out;
}

/** Celdas de una fila de tabla Markdown `| a | b |` (ignora los bordes vacíos). */
function cells(row: string): string[] {
  const t = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map((c) => c.trim());
}

const isTableSeparator = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const isTableRow = (line: string) => line.includes('|') && line.trim().startsWith('|');

function render(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let i = 0;
  let listType: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // Bloque de código ``` … ```
    if (/^\s*```/.test(line)) {
      closeList();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++; // cierre
      html.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // Tabla: fila(s) + separador
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      closeList();
      const header = cells(line).map((c) => `<th>${inline(escapeHtml(c))}</th>`).join('');
      i += 2;
      const body: string[] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        body.push(`<tr>${cells(lines[i]).map((c) => `<td>${inline(escapeHtml(c))}</td>`).join('')}</tr>`);
        i++;
      }
      html.push(`<table><thead><tr>${header}</tr></thead><tbody>${body.join('')}</tbody></table>`);
      continue;
    }

    // Encabezados #..####
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`);
      i++;
      continue;
    }

    // Lista con viñetas
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (listType !== 'ul') {
        closeList();
        html.push('<ul>');
        listType = 'ul';
      }
      html.push(`<li>${inline(escapeHtml(bullet[1]))}</li>`);
      i++;
      continue;
    }

    // Lista numerada
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      if (listType !== 'ol') {
        closeList();
        html.push('<ol>');
        listType = 'ol';
      }
      html.push(`<li>${inline(escapeHtml(numbered[1]))}</li>`);
      i++;
      continue;
    }

    // Línea en blanco: cierra la lista y separa párrafos
    if (!line.trim()) {
      closeList();
      i++;
      continue;
    }

    // Párrafo: agrupa líneas consecutivas de texto
    closeList();
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(#{1,4}\s|[-*]\s|\d+\.\s|```)/.test(lines[i]) &&
      !(isTableRow(lines[i]) && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      buf.push(lines[i++]);
    }
    html.push(`<p>${buf.map((l) => inline(escapeHtml(l))).join('<br>')}</p>`);
  }

  closeList();
  return html.join('');
}
