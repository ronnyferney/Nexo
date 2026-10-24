import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  ConnectorUsage,
  CatalogAccount,
  CatalogEntry,
  CatalogInstallInput,
  CatalogInstallResult,
  DbSchema,
  DiscoverResult,
  EdgeAgent,
  EdgeCreated,
  EdgeOption,
  OAuthStatus,
  StarterKitResult,
} from './integrations.models';

/** Fachada tipada de catálogo, OAuth2 de usuario, base de datos y Nexo Edge (ADR 0005). */
@Injectable({ providedIn: 'root' })
export class IntegrationsApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  private get<T>(path: string) {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`));
  }
  private post<T>(path: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(`${this.base}${path}`, body));
  }
  private delete<T>(path: string) {
    return firstValueFrom(this.http.delete<T>(`${this.base}${path}`));
  }

  // Catálogo
  catalog = () => this.get<CatalogEntry[]>('/connector-catalog');
  install = (catalogId: string, data: CatalogInstallInput) =>
    this.post<CatalogInstallResult>(`/connector-catalog/${encodeURIComponent(catalogId)}/install`, data);
  installCommercialKit = () => this.post<StarterKitResult>('/connector-catalog/starter-kit/commercial');

  // OAuth2 de usuario
  oauthStatus = (connectorId: string) => this.get<OAuthStatus>(`/connectors/${connectorId}/oauth`);
  catalogAccounts = (catalogId: string) => this.get<CatalogAccount[]>(`/connector-catalog/${catalogId}/accounts`);
  connectorUsage = (connectorId: string) => this.get<ConnectorUsage>(`/connectors/${connectorId}/usage`);
  removeConnector = (connectorId: string, purgeSecrets = false) =>
    this.delete(`/connectors/${connectorId}${purgeSecrets ? '?purgeSecrets=true' : ''}`);
  adminConsentUrl = (connectorId: string) =>
    this.get<{ url: string }>(`/connectors/${connectorId}/oauth/admin-consent-url`);
  oauthStart = (connectorId: string) => this.post<{ authorizeUrl: string }>(`/connectors/${connectorId}/oauth/start`);
  oauthDisconnect = (connectorId: string) => this.delete(`/connectors/${connectorId}/oauth`);

  // Base de datos
  schema = (connectorId: string) => this.get<DbSchema>(`/connectors/${connectorId}/schema`);
  discoverTables = (connectorId: string, tables?: string[]) =>
    this.post<DiscoverResult>(`/connectors/${connectorId}/discover`, tables?.length ? { tables } : {});

  // Nexo Edge
  edges = () => this.get<EdgeOption[]>('/edges');
  adminEdges = () => this.get<EdgeAgent[]>('/admin/edges');
  createEdge = (name: string) => this.post<EdgeCreated>('/admin/edges', { name });
  deleteEdge = (id: string) => this.delete(`/admin/edges/${id}`);
  rotateEdgeToken = (id: string) => this.post<{ token: string }>(`/admin/edges/${id}/rotate-token`);
}
