import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type KnowledgeDocument, type KnowledgeSourceType } from '@prisma/client';
import { HttpClientService } from '../../common/http/http-client.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { chunkText } from './chunker';
import type { CreateDocumentDto, CreateKnowledgeBaseDto, UpdateKnowledgeBaseDto } from './dto/knowledge.dto';
import { ALLOWED_EXTENSIONS, extensionOf, fileToText, htmlTitle, htmlToText } from './text-extract';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 20;
const MAX_ERROR_LENGTH = 500;

export interface KnowledgeHit {
  documentId: string;
  title: string;
  content: string;
  score: number;
}

interface IngestSource {
  title: string;
  sourceType: KnowledgeSourceType;
  source: string | null;
}

/** Palabras vacías frecuentes que no aportan a la búsqueda por coincidencia parcial (respaldo ILIKE). */
const STOPWORDS = new Set([
  ...'que los las del con por para una uno unos unas como cual cuál cuales cuáles donde dónde cuando cuándo'.split(' '),
  ...'sus son esta este esto estos estas ese esa eso hay más mas pero sin sobre entre desde hasta'.split(' '),
  ...'qué quién quien cómo the and'.split(' '),
]);

/** Términos para el respaldo ILIKE: palabras únicas de 3+ caracteres, sin palabras vacías (máx. 8). */
export function fallbackTerms(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 8);
}

const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Bases de conocimiento (ADR 0003, D4): ingesta de texto, URL y archivos, fragmentación y búsqueda full-text de
 * PostgreSQL (`spanish`, columna `search` generada + índice GIN, ranking `ts_rank_cd`). La búsqueda es agnóstica del
 * modelo; embeddings/pgvector podrán agregarse detrás de la misma interfaz `search()`.
 */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpClientService,
  ) {}

  // ---------------------------------------------------------------------------------------------- bases

  async list(workspaceId: string) {
    const bases = await this.prisma.knowledgeBase.findMany({
      where: { workspaceId },
      include: { _count: { select: { documents: true, chunks: true, agents: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return bases.map((b) => this.view(b));
  }

  async get(workspaceId: string, id: string) {
    const base = await this.prisma.knowledgeBase.findFirst({
      where: { id, workspaceId },
      include: { _count: { select: { documents: true, chunks: true, agents: true } } },
    });
    if (!base) throw new NotFoundException('Base de conocimiento no encontrada');
    return this.view(base);
  }

  async create(workspaceId: string, dto: CreateKnowledgeBaseDto) {
    const base = await this.prisma.knowledgeBase.create({
      data: { workspaceId, name: dto.name.trim(), description: dto.description?.trim() || null },
    });
    return this.get(workspaceId, base.id);
  }

  async update(workspaceId: string, id: string, dto: UpdateKnowledgeBaseDto) {
    await this.get(workspaceId, id);
    await this.prisma.knowledgeBase.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
      },
    });
    return this.get(workspaceId, id);
  }

  async remove(workspaceId: string, id: string) {
    await this.get(workspaceId, id);
    await this.prisma.knowledgeBase.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------------------------------- documentos

  async documents(workspaceId: string, knowledgeBaseId: string) {
    await this.get(workspaceId, knowledgeBaseId);
    const docs = await this.prisma.knowledgeDocument.findMany({
      where: { knowledgeBaseId },
      include: { _count: { select: { chunks: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return docs.map((d) => this.docView(d, d._count.chunks));
  }

  /** `{ title, text }` o `{ title?, url }`. Un fallo de ingesta deja el documento en FAILED con su error. */
  async addDocument(workspaceId: string, knowledgeBaseId: string, dto: CreateDocumentDto) {
    await this.get(workspaceId, knowledgeBaseId);
    const hasText = dto.text !== undefined;
    const hasUrl = dto.url !== undefined;
    if (hasText === hasUrl) throw new BadRequestException('Indique "text" o "url" (solo uno de los dos)');

    if (hasText) {
      if (!dto.title?.trim()) throw new BadRequestException('El título es obligatorio para documentos de texto');
      return this.ingest(knowledgeBaseId, { title: dto.title.trim(), sourceType: 'TEXT', source: null }, () =>
        Promise.resolve(dto.text!),
      );
    }

    const url = dto.url!;
    let pageTitle: string | null = null;
    const fallbackTitle = dto.title?.trim() || this.urlTitle(url);
    return this.ingest(
      knowledgeBaseId,
      { title: fallbackTitle, sourceType: 'URL', source: url },
      async () => {
        const res = await this.http.request({
          url,
          headers: {
            accept: 'text/html,application/xhtml+xml,text/plain,text/markdown,application/json;q=0.9,*/*;q=0.1',
            'user-agent': 'NexoKnowledgeBot/1.0',
          },
        });
        if (res.status >= 300 && res.status < 400) {
          throw new Error(`La URL redirige (HTTP ${res.status}); use la dirección final`);
        }
        if (!res.ok) throw new Error(`La URL respondió HTTP ${res.status}`);
        const type = (res.headers['content-type'] ?? '').toLowerCase();
        const isHtml = type.includes('html') || (!type && /<html[\s>]/i.test(res.rawBody));
        if (isHtml) {
          pageTitle = htmlTitle(res.rawBody);
          return htmlToText(res.rawBody);
        }
        if (!type || type.startsWith('text/') || type.includes('json') || type.includes('xml')) return res.rawBody;
        throw new Error(`Tipo de contenido no soportado: ${type.split(';')[0]}`);
      },
      () => (!dto.title?.trim() && pageTitle ? pageTitle.slice(0, 200) : undefined),
    );
  }

  async upload(
    workspaceId: string,
    knowledgeBaseId: string,
    file: { originalname: string; buffer: Buffer; size: number } | undefined,
    title?: string,
  ) {
    await this.get(workspaceId, knowledgeBaseId);
    if (!file) throw new BadRequestException('Adjunte un archivo en el campo "file"');
    const ext = extensionOf(file.originalname);
    if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new BadRequestException(`Tipo de archivo no permitido. Use: ${ALLOWED_EXTENSIONS.join(' ')}`);
    }
    if (file.size > MAX_FILE_BYTES) throw new BadRequestException('El archivo excede el tamaño máximo (5 MB)');
    const name = file.originalname.slice(0, 200);
    return this.ingest(
      knowledgeBaseId,
      { title: title?.trim() || name.replace(/\.[^.]+$/, '') || name, sourceType: 'FILE', source: name },
      () => Promise.resolve(fileToText(file.originalname, file.buffer)),
    );
  }

  async removeDocument(workspaceId: string, knowledgeBaseId: string, documentId: string) {
    await this.get(workspaceId, knowledgeBaseId);
    const doc = await this.prisma.knowledgeDocument.findFirst({ where: { id: documentId, knowledgeBaseId } });
    if (!doc) throw new NotFoundException('Documento no encontrado');
    await this.prisma.knowledgeDocument.delete({ where: { id: documentId } });
    await this.touch(knowledgeBaseId);
  }

  // ---------------------------------------------------------------------------------------------- búsqueda

  /**
   * Fragmentos más relevantes de las bases indicadas (solo las del workspace). Estrategia en cascada:
   * 1) `websearch_to_tsquery('spanish')` (todas las palabras); 2) la misma consulta con OR entre términos;
   * 3) respaldo `ILIKE` por términos (útil para códigos, nombres propios o palabras sin raíz en español).
   */
  async search(workspaceId: string, knowledgeBaseIds: string[], query: string, limit = DEFAULT_SEARCH_LIMIT) {
    const q = query.trim();
    const ids = [...new Set(knowledgeBaseIds)];
    if (!q || !ids.length) return [];
    const take = Math.min(Math.max(Math.trunc(limit) || DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);

    const all = Prisma.sql`websearch_to_tsquery('spanish', ${q})`;
    let hits = await this.fullText(workspaceId, ids, all, take);
    if (!hits.length) {
      const any = Prisma.sql`replace(websearch_to_tsquery('spanish', ${q})::text, ' & ', ' | ')::tsquery`;
      hits = await this.fullText(workspaceId, ids, any, take);
    }
    if (!hits.length) hits = await this.likeSearch(workspaceId, ids, fallbackTerms(q), take);
    return hits.map((h) => ({ ...h, score: Math.round(Number(h.score) * 10_000) / 10_000 }));
  }

  private fullText(workspaceId: string, ids: string[], tsquery: Prisma.Sql, limit: number) {
    return this.prisma.$queryRaw<KnowledgeHit[]>`
      SELECT c."documentId" AS "documentId", d."title" AS "title", c."content" AS "content",
             ts_rank_cd(c."search", q.query)::float8 AS "score"
      FROM "KnowledgeChunk" c
      JOIN "KnowledgeDocument" d ON d."id" = c."documentId"
      JOIN "KnowledgeBase" b ON b."id" = c."knowledgeBaseId"
      CROSS JOIN (SELECT ${tsquery} AS query) q
      WHERE b."workspaceId" = ${workspaceId}
        AND c."knowledgeBaseId" = ANY(${ids}::text[])
        AND c."search" @@ q.query
      ORDER BY "score" DESC, d."createdAt" ASC, c."ordinal" ASC
      LIMIT ${limit}`;
  }

  private likeSearch(workspaceId: string, ids: string[], terms: string[], limit: number) {
    if (!terms.length) return Promise.resolve([] as KnowledgeHit[]);
    const patterns = terms.map(likePattern);
    const anyMatch = Prisma.join(
      patterns.map((p) => Prisma.sql`c."content" ILIKE ${p}`),
      ' OR ',
    );
    const matches = Prisma.join(
      patterns.map((p) => Prisma.sql`(CASE WHEN c."content" ILIKE ${p} THEN 1 ELSE 0 END)`),
      ' + ',
    );
    return this.prisma.$queryRaw<KnowledgeHit[]>`
      SELECT c."documentId" AS "documentId", d."title" AS "title", c."content" AS "content",
             ((${matches})::float8 / ${terms.length}::float8) AS "score"
      FROM "KnowledgeChunk" c
      JOIN "KnowledgeDocument" d ON d."id" = c."documentId"
      JOIN "KnowledgeBase" b ON b."id" = c."knowledgeBaseId"
      WHERE b."workspaceId" = ${workspaceId}
        AND c."knowledgeBaseId" = ANY(${ids}::text[])
        AND (${anyMatch})
      ORDER BY "score" DESC, d."createdAt" ASC, c."ordinal" ASC
      LIMIT ${limit}`;
  }

  // ---------------------------------------------------------------------------------------------- internos

  private async ingest(
    knowledgeBaseId: string,
    meta: IngestSource,
    load: () => Promise<string>,
    finalTitle?: () => string | undefined,
  ) {
    let text: string;
    try {
      text = await load();
    } catch (err) {
      return this.failed(knowledgeBaseId, meta, (err as Error).message);
    }
    const title = finalTitle?.() ?? meta.title;
    const chunks = chunkText(text);
    if (!chunks.length) return this.failed(knowledgeBaseId, { ...meta, title }, 'El documento no contiene texto');

    try {
      const doc = await this.prisma.$transaction(async (tx) => {
        const created = await tx.knowledgeDocument.create({
          data: { ...meta, title, knowledgeBaseId, status: 'READY', charCount: text.length },
        });
        // La columna `search` (tsvector) es generada por PostgreSQL a partir de `content`.
        await tx.knowledgeChunk.createMany({
          data: chunks.map((content, ordinal) => ({ ordinal, content, documentId: created.id, knowledgeBaseId })),
        });
        return created;
      });
      await this.touch(knowledgeBaseId);
      return this.docView(doc, chunks.length);
    } catch (err) {
      this.logger.warn(`Ingesta fallida en ${knowledgeBaseId}: ${(err as Error).message}`);
      return this.failed(knowledgeBaseId, { ...meta, title }, 'No se pudo guardar el documento');
    }
  }

  private async failed(knowledgeBaseId: string, meta: IngestSource, error: string) {
    const doc = await this.prisma.knowledgeDocument.create({
      data: { ...meta, knowledgeBaseId, status: 'FAILED', error: error.slice(0, MAX_ERROR_LENGTH), charCount: 0 },
    });
    await this.touch(knowledgeBaseId);
    return this.docView(doc, 0);
  }

  private touch(knowledgeBaseId: string) {
    return this.prisma.knowledgeBase.update({ where: { id: knowledgeBaseId }, data: { updatedAt: new Date() } });
  }

  private urlTitle(url: string): string {
    try {
      const u = new URL(url);
      return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 200);
    } catch {
      return url.slice(0, 200);
    }
  }

  private view(b: {
    id: string;
    name: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
    _count: { documents: number; chunks: number; agents: number };
  }) {
    return {
      id: b.id,
      name: b.name,
      description: b.description,
      documentCount: b._count.documents,
      chunkCount: b._count.chunks,
      agentCount: b._count.agents,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    };
  }

  private docView(d: KnowledgeDocument, chunkCount: number) {
    return {
      id: d.id,
      title: d.title,
      sourceType: d.sourceType,
      source: d.source,
      status: d.status,
      error: d.error,
      chunkCount,
      charCount: d.charCount,
      createdAt: d.createdAt,
    };
  }
}
