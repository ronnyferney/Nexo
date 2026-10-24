import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { Connector, Operation } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { JsonEditorComponent } from '../../shared/json-editor.component';
import { OAUTH_QUERY_CLEAR, oauthErrorMessage } from '../../shared/oauth-result';
import { TemplateRefPipe } from '../../shared/template-ref.pipe';
import { AUTH_TYPES, DEFAULT_DEFINITION, DEFAULT_SCHEMA } from './connector-presets';
import { ConnectorOAuthComponent } from './connector-oauth.component';
import { ConnectorSecretsComponent } from './connector-secrets.component';
import { DatabaseConfigComponent } from './database-config.component';
import { QueryResultTableComponent } from './query-result-table.component';
import { SchemaExplorerComponent } from './schema-explorer.component';
import { SqlOperationEditorComponent } from './sql-operation-editor.component';
import { blockedRefs, secretRefs } from './secret-refs';
import { asSqlResult, detectSqlParams } from './sql-params';

type InvokeResult = { ok: boolean; status?: number; data: unknown; durationMs: number };

type OpDraft = Partial<Operation> & { isNew?: boolean };

@Component({
  selector: 'nx-connector-detail',
  imports: [
    FormsModule,
    RouterLink,
    IconComponent,
    JsonEditorComponent,
    TemplateRefPipe,
    ConnectorOAuthComponent,
    ConnectorSecretsComponent,
    DatabaseConfigComponent,
    SchemaExplorerComponent,
    SqlOperationEditorComponent,
    QueryResultTableComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './connector-detail.page.html',
  styles: `
    .ops { display: grid; grid-template-columns: 300px 1fr; gap: 16px; align-items: start; }
    .op-item { display: block; width: 100%; text-align: left; padding: 10px 12px; border: 1px solid transparent; border-radius: 9px; background: none; color: inherit; font: inherit; cursor: pointer; }
    .op-item:hover { background: var(--surface-2); }
    .op-item.active { border-color: var(--primary); background: var(--primary-50); }
    .op-item code { color: var(--muted); font-size: 11.5px; }
    .result { margin-top: 8px; }
    .oauth, .secrets { display: block; margin-bottom: 16px; }
    @media (max-width: 900px) { .ops { grid-template-columns: 1fr; } }
  `,
})
export class ConnectorDetailPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  readonly id = input.required<string>();
  /** Resultado del consentimiento OAuth2 al volver del proveedor: `?oauth=ok|error&reason=<código>` (ADR 0005 D3). */
  readonly oauth = input<string>();
  readonly oauthReason = input<string>(undefined, { alias: 'reason' });
  readonly authTypes = AUTH_TYPES;

  readonly connector = signal<Connector | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly tab = signal<'config' | 'schema' | 'operations'>('config');
  readonly busy = signal<string | null>(null);
  readonly testResult = signal<{ ok: boolean; message: string } | null>(null);
  readonly selected = signal<OpDraft | null>(null);
  readonly invokeResult = signal<InvokeResult | null>(null);
  readonly isOAuth = computed(() => this.connector()?.auth?.['type'] === 'oauth2_code');
  readonly sqlResult = computed(() => (this.connector()?.type === 'DATABASE' ? asSqlResult(this.invokeResult()?.data) : null));

  name = '';
  description = '';
  config: Record<string, any> = {};
  authCfg: Record<string, any> = { type: 'none' };
  headers: unknown = {};
  invokeInput: unknown = {};

  async ngOnInit() {
    this.handleOAuthReturn();
    await this.load();
  }

  private handleOAuthReturn() {
    const result = this.oauth();
    if (!result) return;
    if (result === 'ok') this.toast.success('Cuenta conectada correctamente');
    else this.toast.error(oauthErrorMessage(this.oauthReason()));
    void this.router.navigate([], { relativeTo: this.route, queryParams: OAUTH_QUERY_CLEAR, queryParamsHandling: 'merge', replaceUrl: true });
  }

  async load() {
    this.loadError.set(null);
    let c: Connector;
    try {
      c = await this.api.connector(this.id());
    } catch (e) {
      if (!this.connector()) this.loadError.set(errorMessage(e));
      else this.toast.error(errorMessage(e));
      return;
    }
    this.connector.set(c);
    this.name = c.name;
    this.description = c.description ?? '';
    this.config = { ...c.config };
    this.headers = c.config['headers'] ?? {};
    this.authCfg = { ...c.auth };
    const sel = this.selected();
    if (sel?.id) this.selected.set(c.operations?.find((o) => o.id === sel.id) ?? null);
  }

  async save() {
    await this.run('save', async () => {
      await this.api.updateConnector(this.id(), {
        name: this.name,
        description: this.description || undefined,
        config: this.connector()?.type === 'DATABASE' ? this.config : { ...this.config, headers: this.headers },
        auth: this.authCfg,
      });
      this.toast.success('Conector guardado');
      await this.load();
    });
  }

  async test() {
    this.testResult.set(null);
    await this.run('test', async () => this.testResult.set(await this.api.testConnector(this.id())));
  }

  async discover() {
    await this.run('discover', async () => {
      const r = await this.api.discoverConnector(this.id());
      this.toast.success(`${r.imported} operaciones importadas`);
      await this.load();
      this.tab.set('operations');
    });
  }

  async remove() {
    if (!confirm('¿Eliminar este conector y todas sus operaciones?')) return;
    await this.api.deleteConnector(this.id());
    await this.router.navigate(['/connectors']);
  }

  onQueriesCreated() {
    void this.load().then(() => this.tab.set('operations'));
  }

  scopesText() {
    const s = this.authCfg['scopes'];
    return Array.isArray(s) ? s.join(' ') : (s ?? '');
  }

  setScopes(text: string) {
    this.authCfg = { ...this.authCfg, scopes: text.split(/\s+/).filter(Boolean) };
  }

  setAuthType(type: string) {
    this.authCfg = { type, ...(type === 'apiKey' ? { in: 'header', name: 'x-api-key', value: '{{ secrets.API_KEY }}' } : {}) };
  }

  newOperation() {
    const type = this.connector()!.type;
    this.invokeResult.set(null);
    this.selected.set({ isNew: true, key: '', name: '', description: '', definition: DEFAULT_DEFINITION[type], inputSchema: DEFAULT_SCHEMA });
  }

  selectOperation(op: Operation) {
    this.invokeResult.set(null);
    this.invokeInput =
      this.connector()?.type === 'DATABASE'
        ? Object.fromEntries(detectSqlParams(String(op.definition?.['sql'] ?? '')).map((p) => [p, '']))
        : {};
    this.selected.set({ ...op });
  }

  async saveOperation() {
    const op = this.selected()!;
    const body = { key: op.key, name: op.name, description: op.description || undefined, definition: op.definition, inputSchema: op.inputSchema };
    await this.run('op', async () => {
      const saved = op.isNew ? await this.api.createOperation(this.id(), body) : await this.api.updateOperation(this.id(), op.id!, body);
      this.toast.success('Operación guardada');
      this.selected.set(saved);
      await this.load();
    });
  }

  async deleteOperation() {
    const op = this.selected();
    if (!op?.id || !confirm(`¿Eliminar la operación "${op.name}"?`)) return;
    await this.api.deleteOperation(this.id(), op.id);
    this.selected.set(null);
    await this.load();
  }

  async invoke() {
    const op = this.selected();
    if (!op?.id) return;
    this.invokeResult.set(null);
    await this.run('invoke', async () => this.invokeResult.set(await this.api.invokeOperation(this.id(), op.id!, this.invokeInput)));
  }

  patchSelected(patch: Partial<OpDraft>) {
    this.selected.update((s) => (s ? { ...s, ...patch } : s));
  }

  discoverLabel(type: string) {
    return { REST: 'Importar OpenAPI', SOAP: 'Importar WSDL', MCP: 'Descubrir tools MCP' }[type] ?? 'Descubrir';
  }

  /** Referencias a secretos del editor sin guardar: configuración, autenticación y la operación abierta. */
  draftSecretRefs(): string[] {
    const config = this.connector()?.type === 'DATABASE' ? this.config : { ...this.config, headers: this.headers };
    return secretRefs(config, this.authCfg, this.selected()?.definition);
  }

  /** Referencias del editor que no están entre los secretos permitidos del conector (A4). */
  draftBlocked(definition?: unknown): string[] {
    const refs = definition === undefined ? secretRefs(this.config, this.headers, this.authCfg) : secretRefs(definition);
    return blockedRefs(refs, this.connector()?.allowedSecrets);
  }

  onSecretsSaved(c: Connector) {
    this.connector.update((cur) => (cur ? { ...cur, ...c, operations: cur.operations } : c));
    void this.load();
  }

  json(v: unknown) {
    return JSON.stringify(v, null, 2);
  }

  private async run(key: string, fn: () => Promise<void>) {
    this.busy.set(key);
    try {
      await fn();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }
}
