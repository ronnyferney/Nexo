import { BadRequestException, Injectable } from '@nestjs/common';
import { HttpClientService } from '../../../common/http/http-client.service';
import { evaluateExpression, getPath, render, type TemplateContext } from '../../../common/template/template.engine';
import type { ConnectorAdapter } from '../domain/connector-adapter';
import type {
  ConnectorRuntime,
  DiscoveredOperation,
  InvocationResult,
  OperationRuntime,
  RestConfig,
  RestOperationDef,
  TestResult,
} from '../domain/connector.types';
import { AuthResolverService } from './auth-resolver.service';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

@Injectable()
export class RestAdapter implements ConnectorAdapter {
  readonly type = 'REST' as const;

  constructor(
    private readonly http: HttpClientService,
    private readonly authResolver: AuthResolverService,
  ) {}

  async invoke(
    connector: ConnectorRuntime,
    operation: OperationRuntime,
    input: Record<string, unknown>,
  ): Promise<InvocationResult> {
    const ctx = { input, secrets: connector.secrets };
    const config = render<RestConfig>(connector.config, ctx);
    const def = render<RestOperationDef>(operation.definition, ctx);
    // La ruta se renderiza aparte: cada valor interpolado va codificado como segmento (no puede añadir `/`, `?`, `#`).
    def.path = renderPath((operation.definition as Partial<RestOperationDef>).path, ctx);
    const auth = await this.authResolver.resolve(connector);

    // El host del conector sale de la configuración sin `input`: ningún valor de la operación puede cambiarlo.
    const connectorBase = render<RestConfig>(connector.config, { secrets: connector.secrets }).baseUrl;
    const url = buildOperationUrl(config.baseUrl, def.path, connectorBase);
    for (const [k, v] of Object.entries({ ...(def.query ?? {}), ...auth.query })) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {
      accept: 'application/json',
      ...config.headers,
      ...def.headers,
      ...auth.headers,
    };
    let body: string | undefined;
    if (def.body !== undefined && def.method !== 'GET') {
      if (def.bodyType === 'form') {
        headers['content-type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(def.body as Record<string, string>).toString();
      } else if (def.bodyType === 'text') {
        headers['content-type'] ??= 'text/plain';
        body = String(def.body);
      } else {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(def.body);
      }
    }

    const res = await this.http.request({
      url: url.toString(),
      method: def.method,
      headers,
      body,
      timeoutMs: config.timeoutMs,
    });
    const ok = res.ok && (!def.successPath || getPath(res.body, def.successPath) === true);
    return { ok, status: res.status, data: res.body, durationMs: res.durationMs };
  }

  async test(connector: ConnectorRuntime): Promise<TestResult> {
    const config = render<RestConfig>(connector.config, { secrets: connector.secrets });
    const auth = await this.authResolver.resolve(connector);
    const res = await this.http.request({
      url: config.baseUrl,
      method: 'GET',
      headers: { ...config.headers, ...auth.headers },
    });
    return { ok: res.status < 500, message: `HTTP ${res.status} en ${res.durationMs} ms` };
  }

  /** Importa operaciones desde una especificación OpenAPI 3 (JSON). */
  async discover(connector: ConnectorRuntime): Promise<DiscoveredOperation[]> {
    const config = render<RestConfig>(connector.config, { secrets: connector.secrets });
    if (!config.openApiUrl) throw new Error('Configure "openApiUrl" para descubrir operaciones');
    const res = await this.http.request({ url: config.openApiUrl, headers: { accept: 'application/json' } });
    if (typeof res.body !== 'object') throw new Error('La especificación OpenAPI debe estar en formato JSON');
    return openApiToOperations(res.body as OpenApiDoc);
  }
}

const EXPR = /\{\{\s*([^}]+?)\s*\}\}/g;
/** Segmento `.`/`..`, también codificado (`%2e`), que el parser de URL interpretaría como recorrido de ruta. */
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;

/** `encodeURIComponent` deja de codificar `:`, `@` y `=`, válidos en un segmento (RFC 3986 `pchar`) y usados en ids. */
function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%(3A|40|3D)/gi, (m) => decodeURIComponent(m));
}

/**
 * Renderiza la plantilla de ruta codificando cada valor interpolado: antes del primer `?`/`#` literal como segmento
 * de ruta (no puede introducir `/`, `?`, `#`, `%` ni `;`), y después como valor de query (`encodeURIComponent`, sin
 * `&` ni `=` crudos). El texto literal de la plantilla (definido por quien configura la operación) no se altera.
 */
export function renderPath(template: unknown, ctx: TemplateContext): string {
  if (template === undefined || template === null) return '';
  const text = String(template);
  const queryStart = text.search(/[?#]/);
  return text.replace(EXPR, (_match: string, expr: string, offset: number) => {
    const value = evaluateExpression(expr, ctx);
    if (value === undefined || value === null) return '';
    const raw = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return queryStart >= 0 && offset > queryStart ? encodeURIComponent(raw) : encodePathSegment(raw);
  });
}

/**
 * Une `baseUrl` y la ruta ya renderizada, y rechaza lo que saque la petición del conector: segmentos `.`/`..`, una
 * URL absoluta (o `//host`) hacia otro origen, o una ruta que termine fuera de la ruta base.
 */
export function buildOperationUrl(baseUrl: string, path: string, connectorBaseUrl: string = baseUrl): URL {
  const expected = new URL(connectorBaseUrl);
  const p = path ?? '';
  const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(p) || /^[/\\]{2}/.test(p);
  // Se revisa el texto antes de que `new URL()` normalice los `..` (el parser trata `\` como `/`).
  const rawPath = (isAbsolute ? p.replace(/^[a-z][a-z0-9+.-]*:/i, '').replace(/^[/\\]{2}[^/\\?#]*/, '') : p).split(
    /[?#]/,
    1,
  )[0];
  if (rawPath.split(/[/\\]/).some((seg) => DOT_SEGMENT.test(seg))) {
    throw new BadRequestException('Ruta de operación inválida: no se permiten segmentos "." o ".."');
  }
  const url = isAbsolute ? new URL(p, expected) : new URL(`${baseUrl.replace(/\/+$/, '')}/${p.replace(/^\/+/, '')}`);
  if (url.origin !== expected.origin) {
    throw new BadRequestException(`Ruta de operación inválida: el destino debe ser ${expected.host}`);
  }
  const basePath = expected.pathname.replace(/\/+$/, '');
  if (!isAbsolute && basePath && url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
    throw new BadRequestException('Ruta de operación inválida: sale de la ruta base del conector');
  }
  return url;
}

interface OpenApiParam {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: Record<string, unknown>;
}
interface OpenApiOp {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OpenApiParam[];
  requestBody?: { content?: Record<string, { schema?: Record<string, unknown> }> };
}
export interface OpenApiDoc {
  paths?: Record<string, Partial<Record<(typeof HTTP_METHODS)[number], OpenApiOp>>>;
}

export function openApiToOperations(doc: OpenApiDoc): DiscoveredOperation[] {
  const ops: DiscoveredOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = item?.[method];
      if (!op) continue;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      const query: Record<string, string> = {};
      let templatedPath = path;

      for (const p of op.parameters ?? []) {
        if (p.in !== 'path' && p.in !== 'query') continue;
        properties[p.name] = { ...(p.schema ?? { type: 'string' }), description: p.description };
        if (p.required || p.in === 'path') required.push(p.name);
        if (p.in === 'path') templatedPath = templatedPath.replace(`{${p.name}}`, `{{ input.${p.name} }}`);
        else query[p.name] = `{{ input.${p.name} }}`;
      }
      const bodySchema = op.requestBody?.content?.['application/json']?.schema;
      if (bodySchema) {
        properties.body = bodySchema;
        required.push('body');
      }

      const key = (op.operationId ?? `${method}_${path}`)
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 64);
      ops.push({
        key,
        name: op.summary ?? key,
        description: op.description ?? op.summary,
        inputSchema: { type: 'object', properties, required },
        definition: {
          method: method.toUpperCase(),
          path: templatedPath,
          query,
          ...(bodySchema ? { body: '{{ input.body }}', bodyType: 'json' } : {}),
        },
      });
    }
  }
  return ops;
}
