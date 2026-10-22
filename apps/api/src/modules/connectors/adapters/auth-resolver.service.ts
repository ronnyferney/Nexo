import { Injectable } from '@nestjs/common';
import { HttpClientService } from '../../../common/http/http-client.service';
import { render } from '../../../common/template/template.engine';
import type { ConnectorAuth, ConnectorRuntime } from '../domain/connector.types';

export interface ResolvedAuth {
  headers: Record<string, string>;
  query: Record<string, string>;
}

/** Traduce la autenticación declarativa a headers/query, con caché de tokens OAuth2. */
@Injectable()
export class AuthResolverService {
  private readonly tokenCache = new Map<string, { token: string; expiresAt: number }>();

  constructor(private readonly http: HttpClientService) {}

  async resolve(connector: ConnectorRuntime): Promise<ResolvedAuth> {
    const auth = render<ConnectorAuth>(connector.auth ?? { type: 'none' }, { secrets: connector.secrets });
    switch (auth.type) {
      case 'apiKey':
        return auth.in === 'query'
          ? { headers: {}, query: { [auth.name]: auth.value } }
          : { headers: { [auth.name]: auth.value }, query: {} };
      case 'bearer':
        return { headers: { authorization: `Bearer ${auth.token}` }, query: {} };
      case 'basic':
        return {
          headers: { authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}` },
          query: {},
        };
      case 'oauth2':
        return { headers: { authorization: `Bearer ${await this.clientCredentials(connector.id, auth)}` }, query: {} };
      default:
        return { headers: {}, query: {} };
    }
  }

  private async clientCredentials(cacheKey: string, auth: Extract<ConnectorAuth, { type: 'oauth2' }>): Promise<string> {
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: auth.clientId,
      client_secret: auth.clientSecret,
    });
    if (auth.scope) body.set('scope', auth.scope);
    const res = await this.http.request({
      url: auth.tokenUrl,
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    });
    const data = res.body as { access_token?: string; expires_in?: number };
    if (!res.ok || !data?.access_token) throw new Error(`OAuth2: no se pudo obtener token (HTTP ${res.status})`);
    this.tokenCache.set(cacheKey, {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    });
    return data.access_token;
  }
}
