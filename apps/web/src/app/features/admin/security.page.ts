import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { TemplateRefPipe } from '../../shared/template-ref.pipe';

@Component({
  selector: 'nx-admin-security',
  imports: [FormsModule, IconComponent, RelativeTimePipe, TemplateRefPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Seguridad</h1><p>Secretos, llaves de API y servidor MCP del workspace</p></div></div>

      <div class="grid grid-2">
        <div class="card stack">
          <div class="card-title"><div class="icon-tile"><nx-icon name="lock" /></div><div><h2>Secretos</h2><p class="muted small">Cifrados con AES-256-GCM. Úselos como <code>{{ 'secrets.NOMBRE' | tpl }}</code> en conectores.</p></div></div>
          <div class="row">
            <input class="input mono" placeholder="NOMBRE_SECRETO" [(ngModel)]="secretName" />
            <input class="input" type="password" placeholder="valor" [(ngModel)]="secretValue" />
            <button class="btn primary" [disabled]="!secretName || !secretValue" (click)="saveSecret()">Guardar</button>
          </div>
          <table class="table">
            <tbody>
              @for (s of secrets(); track s.id) {
                <tr><td class="mono">{{ s.name }}</td><td class="muted small">actualizado {{ s.updatedAt | ago }}</td>
                  <td style="text-align:right"><button class="btn ghost icon sm danger" (click)="deleteSecret(s.id)"><nx-icon name="trash" [size]="14" /></button></td></tr>
              } @empty { <tr><td class="muted">Sin secretos.</td></tr> }
            </tbody>
          </table>
        </div>

        <div class="card stack">
          <div class="card-title"><div class="icon-tile"><nx-icon name="key" /></div><div><h2>API keys</h2><p class="muted small">Para integraciones máquina a máquina y el servidor MCP.</p></div></div>
          <div class="row">
            <input class="input" placeholder="Nombre (ej. Claude Desktop)" [(ngModel)]="keyName" />
            <button class="btn primary" [disabled]="keyName.length < 2" (click)="createKey()">Crear</button>
          </div>
          @if (newKey()) {
            <div class="card" style="background:var(--warning-50); box-shadow:none; border-color:var(--warning)">
              <strong class="small">Copie la llave ahora; no volverá a mostrarse.</strong>
              <div class="row" style="margin-top:8px"><input class="input mono small" readonly [value]="newKey()" />
                <button class="btn icon" (click)="copy(newKey()!)"><nx-icon name="copy" [size]="15" /></button></div>
            </div>
          }
          <table class="table">
            <tbody>
              @for (k of keys(); track k.id) {
                <tr><td><strong>{{ k.name }}</strong><div class="mono small muted">{{ k.prefix }}…</div></td>
                  <td class="muted small">{{ k.lastUsedAt ? 'usada ' + (k.lastUsedAt | ago) : 'sin uso' }}</td>
                  <td style="text-align:right"><button class="btn ghost icon sm danger" (click)="deleteKey(k.id)"><nx-icon name="trash" [size]="14" /></button></td></tr>
              } @empty { <tr><td class="muted">Sin llaves.</td></tr> }
            </tbody>
          </table>
        </div>
      </div>

      <div class="card stack" style="margin-top:16px">
        <div class="card-title"><div class="icon-tile MCP"><nx-icon name="sparkles" /></div><div><h2>Servidor MCP de Nexo</h2>
          <p class="muted small">Cada agente y cada flujo activo del workspace se publica como una tool MCP.</p></div></div>
        <div class="field"><label>Endpoint (Streamable HTTP)</label>
          <div class="row"><input class="input mono" readonly [value]="mcpUrl" /><button class="btn icon" (click)="copy(mcpUrl)"><nx-icon name="copy" [size]="15" /></button></div></div>
        <div class="field"><label>Configuración para clientes MCP (Claude Desktop, Cursor, VS Code…)</label>
          <pre class="code-block">{{ mcpConfig }}</pre></div>
      </div>
    </div>
  `,
})
export class SecurityPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  readonly secrets = signal<{ id: string; name: string; updatedAt: string }[]>([]);
  readonly keys = signal<{ id: string; name: string; prefix: string; lastUsedAt?: string }[]>([]);
  readonly newKey = signal<string | null>(null);
  secretName = '';
  secretValue = '';
  keyName = '';
  readonly mcpUrl = `${location.origin}/api/mcp`;
  readonly mcpConfig = JSON.stringify(
    { mcpServers: { nexo: { type: 'http', url: this.mcpUrl, headers: { Authorization: 'Bearer nexo_SU_API_KEY' } } } },
    null,
    2,
  );

  async ngOnInit() {
    await this.load();
  }

  async load() {
    const [s, k] = await Promise.all([this.api.secrets(), this.api.apiKeys()]);
    this.secrets.set(s);
    this.keys.set(k);
  }

  async saveSecret() {
    try {
      await this.api.upsertSecret(this.secretName.trim().toUpperCase(), this.secretValue);
      this.secretName = this.secretValue = '';
      this.toast.success('Secreto guardado');
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async deleteSecret(id: string) {
    if (!confirm('¿Eliminar este secreto? Los conectores que lo usan dejarán de autenticarse.')) return;
    await this.api.deleteSecret(id);
    await this.load();
  }

  async createKey() {
    try {
      const r = await this.api.createApiKey(this.keyName);
      this.newKey.set(r.key);
      this.keyName = '';
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async deleteKey(id: string) {
    if (!confirm('¿Revocar esta llave?')) return;
    await this.api.deleteApiKey(id);
    await this.load();
  }

  copy(text: string) {
    void navigator.clipboard?.writeText(text);
    this.toast.info('Copiado al portapapeles');
  }
}
