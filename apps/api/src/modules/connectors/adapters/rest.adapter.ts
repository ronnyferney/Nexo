import { Injectable } from '@nestjs/common';
import { HttpClientService } from '../../../common/http/http-client.service';
import { render } from '../../../common/template/template.engine';
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
    const auth = await this.authResolver.resolve(connector);

    const url = new URL(joinUrl(config.baseUrl, def.path));
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
    return { ok: res.ok, status: res.status, data: res.body, durationMs: res.durationMs };
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

function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${base.replace(/\/+$/, '')}/${(path ?? '').replace(/^\/+/, '')}`;
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
