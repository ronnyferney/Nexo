import { Injectable } from '@nestjs/common';
import { HttpClientService } from '../../../common/http/http-client.service';
import { render } from '../../../common/template/template.engine';
import type { ConnectorAdapter } from '../domain/connector-adapter';
import type {
  ConnectorRuntime,
  GraphqlConfig,
  GraphqlOperationDef,
  InvocationResult,
  OperationRuntime,
  TestResult,
} from '../domain/connector.types';
import { AuthResolverService } from './auth-resolver.service';

@Injectable()
export class GraphqlAdapter implements ConnectorAdapter {
  readonly type = 'GRAPHQL' as const;

  constructor(
    private readonly http: HttpClientService,
    private readonly authResolver: AuthResolverService,
  ) {}

  async invoke(
    connector: ConnectorRuntime,
    operation: OperationRuntime,
    input: Record<string, unknown>,
  ): Promise<InvocationResult> {
    const config = render<GraphqlConfig>(connector.config, { secrets: connector.secrets });
    const def = operation.definition as unknown as GraphqlOperationDef;
    const variables = def.variables ? render(def.variables, { input, secrets: connector.secrets }) : input;
    const res = await this.post(connector, config, { query: def.query, variables });
    const payload = res.body as { data?: unknown; errors?: unknown[] };
    return {
      ok: res.ok && !payload?.errors?.length,
      status: res.status,
      data: payload?.errors?.length ? { errors: payload.errors, data: payload.data } : payload?.data,
      durationMs: res.durationMs,
    };
  }

  async test(connector: ConnectorRuntime): Promise<TestResult> {
    const config = render<GraphqlConfig>(connector.config, { secrets: connector.secrets });
    const res = await this.post(connector, config, { query: '{ __typename }' });
    return { ok: res.ok, message: `HTTP ${res.status} en ${res.durationMs} ms`, details: res.body };
  }

  private async post(connector: ConnectorRuntime, config: GraphqlConfig, payload: unknown) {
    const auth = await this.authResolver.resolve(connector);
    return this.http.request({
      url: config.endpoint,
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...config.headers, ...auth.headers },
      body: JSON.stringify(payload),
    });
  }
}
