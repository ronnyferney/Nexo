import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Base de conocimiento del producto (ADR 0006 D6): Markdown versionado en `definition/knowledge/`, cargado en memoria y
 * consultado con búsqueda léxica BM25. No usa la base de datos de los clientes ni consume IA.
 */
export interface ProductDoc {
  /** Nombre del archivo sin extensión. */
  id: string;
  title: string;
  content: string;
}

export interface ProductDocSection {
  docId: string;
  docTitle: string;
  heading: string;
  text: string;
}

export interface ProductDocHit extends ProductDocSection {
  score: number;
}

const STOPWORDS = new Set(
  (
    'los las del que con por para una uno unos unas como mas pero sus este esta estos estas ese esa eso cual cuales ' +
    'cuando donde quien sobre entre sin son ser hay muy tambien puede pueden debe deben esto todo toda todos todas ' +
    'otro otra the and for with that this from are how what you your can does into tiene tienen hace hacer'
  ).split(' '),
);

/** Minúsculas, sin acentos, palabras de 3+ caracteres sin palabras vacías; plural simple → singular. */
export function tokenize(text: string): string[] {
  const words =
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .match(/[a-z0-9]{3,}/g) ?? [];
  return words.filter((w) => !STOPWORDS.has(w)).map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w));
}

/** Divide un documento Markdown en secciones `##` (el texto previo a la primera sección forma la sección "Resumen"). */
export function splitSections(doc: ProductDoc): ProductDocSection[] {
  const sections: ProductDocSection[] = [];
  let heading = doc.title;
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) sections.push({ docId: doc.id, docTitle: doc.title, heading, text });
    buffer = [];
  };
  for (const line of doc.content.split('\n')) {
    if (/^#\s/.test(line)) continue;
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      flush();
      heading = h2[1].trim();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

const K1 = 1.2;
const B = 0.75;
/** Peso extra de los términos del título del documento y del encabezado de la sección. */
const TITLE_BOOST = 2;

interface IndexedSection {
  section: ProductDocSection;
  tf: Map<string, number>;
  length: number;
}

export class ProductDocsIndex {
  private readonly items: IndexedSection[];
  private readonly df = new Map<string, number>();
  private readonly avgLength: number;

  constructor(readonly docs: ProductDoc[]) {
    this.items = docs.flatMap(splitSections).map((section) => {
      const tf = new Map<string, number>();
      const add = (tokens: string[], weight: number) => {
        for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + weight);
      };
      const body = tokenize(section.text);
      add(body, 1);
      add(tokenize(`${section.docTitle} ${section.heading}`), TITLE_BOOST);
      return { section, tf, length: body.length || 1 };
    });
    for (const item of this.items) for (const term of item.tf.keys()) this.df.set(term, (this.df.get(term) ?? 0) + 1);
    this.avgLength = this.items.reduce((acc, i) => acc + i.length, 0) / (this.items.length || 1);
  }

  get size(): number {
    return this.items.length;
  }

  search(query: string, limit = 4): ProductDocHit[] {
    const terms = [...new Set(tokenize(query))];
    if (!terms.length) return [];
    const n = this.items.length;
    const scored = this.items.map((item) => {
      let score = 0;
      for (const term of terms) {
        const f = item.tf.get(term);
        if (!f) continue;
        const df = this.df.get(term) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * item.length) / this.avgLength));
      }
      return { ...item.section, score: Math.round(score * 1000) / 1000 };
    });
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(limit, 10)));
  }
}

/** Directorios candidatos: junto al código compilado (assets de nest) o el fuente (ts-node / jest). */
export function knowledgeDirCandidates(): string[] {
  return [join(__dirname, 'knowledge'), join(process.cwd(), 'src/modules/copilot/definition/knowledge')];
}

export function loadProductDocs(dirs = knowledgeDirCandidates()): ProductDoc[] {
  const dir = dirs.find((d) => existsSync(d));
  if (!dir) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((file) => {
      const content = readFileSync(join(dir, file), 'utf8');
      const title = /^#\s+(.+)$/m.exec(content)?.[1].trim() ?? file.replace(/\.md$/, '');
      return { id: file.replace(/\.md$/, ''), title, content };
    });
}

let shared: ProductDocsIndex | undefined;
/** Índice compartido del proceso (los documentos son inmutables durante la ejecución). */
export function productDocsIndex(): ProductDocsIndex {
  shared ??= new ProductDocsIndex(loadProductDocs());
  return shared;
}

/** Texto de resultado de `search_product_docs` para el modelo. */
export function formatDocHits(query: string, hits: ProductDocHit[]): string {
  if (!hits.length) return `No se encontró información en la guía de Nexo para: "${query}".`;
  return hits.map((h, i) => `[${i + 1}] ${h.docTitle} › ${h.heading}\n${h.text}`).join('\n\n---\n\n');
}
