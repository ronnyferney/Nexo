import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHash } from 'node:crypto';
import { HttpClientService } from '../../../common/http/http-client.service';
import { render } from '../../../common/template/template.engine';
import type { ConnectorAdapter } from '../domain/connector-adapter';
import type {
  ConnectorRuntime,
  DiscoveredOperation,
  InvocationResult,
  McpConfig,
  McpOperationDef,
  OperationRuntime,
  TestResult,
} from '../domain/connector.types';
import { AuthResolverService } from './auth-resolver.service';

const IDLE_MS = 5 * 60_000;

interface PooledClient {
  client: Client;
  fingerprint: string;
  lastUsed: number;
}

/**
 * Cliente MCP (Model Context Protocol) remoto: Streamable HTTP o SSE.
 * Las tools del servidor MCP se importan como operaciones del conector.
 * Mantiene un pool de sesiones por conector que se cierra por inactividad.
 */
@Injectable()
export class McpAdapter implements ConnectorAdapter, OnModuleDestroy {
  readonly type = 'MCP' as const;
  private readonly logger = new Logger(McpAdapter.name);
  private readonly pool = new Map<string, PooledClient>();
  private readonly sweeper = setInterval(() => this.sweep(), 60_000).unref();

  constructor(
    private readonly http: HttpClientService,
    private readonly authResolver: AuthResolverService,
  ) {}

  async invoke(
    connector: ConnectorRuntime,
    operation: OperationRuntime,
    input: Record<string, unknown>,
  ): Promise<InvocationResult> {
    const def = operation.definition as unknown as McpOperationDef;
    const started = Date.now();
    const result = await this.withClient(connector, (client) =>
      client.callTool({ name: def.toolName, arguments: input }),
    );
    const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
    const texts = content.filter((c) => c.type === 'text').map((c) => c.text ?? '');
    return {
      ok: !result.isError,
      data: result.structuredContent ?? (texts.length === 1 ? tryJson(texts[0]) : content),
      durationMs: Date.now() - started,
    };
  }

  async test(connector: ConnectorRuntime): Promise<TestResult> {
    const tools = await this.withClient(connector, (c) => c.listTools());
    const server = this.pool.get(connector.id)?.client.getServerVersion();
    return {
      ok: true,
      message: `Conectado a ${server?.name ?? 'servidor MCP'} ${server?.version ?? ''} — ${tools.tools.length} tools`,
    };
  }

  async discover(connector: ConnectorRuntime): Promise<DiscoveredOperation[]> {
    const { tools } = await this.withClient(connector, (c) => c.listTools());
    return tools.map((t) => ({
      key: t.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
      name: t.title ?? t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      definition: { toolName: t.name },
    }));
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.sweeper);
    await Promise.all([...this.pool.values()].map((p) => p.client.close().catch(() => undefined)));
    this.pool.clear();
  }

  private async withClient<T>(connector: ConnectorRuntime, fn: (client: Client) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.acquire(connector));
    } catch (err) {
      // Sesión caída: se descarta y se reintenta una vez con una conexión nueva.
      await this.evict(connector.id);
      this.logger.warn(`Reintentando MCP ${connector.id}: ${(err as Error).message}`);
      return fn(await this.acquire(connector));
    }
  }

  private async acquire(connector: ConnectorRuntime): Promise<Client> {
    const config = render<McpConfig>(connector.config, { secrets: connector.secrets });
    const auth = await this.authResolver.resolve(connector);
    const headers = { ...config.headers, ...auth.headers };
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([config, headers]))
      .digest('hex');

    const pooled = this.pool.get(connector.id);
    if (pooled && pooled.fingerprint === fingerprint) {
      pooled.lastUsed = Date.now();
      return pooled.client;
    }
    if (pooled) await this.evict(connector.id);

    const url = new URL(config.url);
    await this.http.assertPublicHost(url.hostname);
    const client = new Client({ name: 'nexo', version: '1.0.0' });
    const transport =
      config.transport === 'sse'
        ? new SSEClientTransport(url, { requestInit: { headers } })
        : new StreamableHTTPClientTransport(url, { requestInit: { headers } });
    await client.connect(transport);
    this.pool.set(connector.id, { client, fingerprint, lastUsed: Date.now() });
    return client;
  }

  private async evict(id: string): Promise<void> {
    const pooled = this.pool.get(id);
    this.pool.delete(id);
    await pooled?.client.close().catch(() => undefined);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, p] of this.pool) if (now - p.lastUsed > IDLE_MS) void this.evict(id);
  }
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
