import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { TemplateRefPipe } from '../../shared/template-ref.pipe';
import { ApiKeysComponent } from './api-keys/api-keys.component';

@Component({
  selector: 'nx-admin-security',
  imports: [FormsModule, IconComponent, RelativeTimePipe, TemplateRefPipe, ApiKeysComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Seguridad</h1><p>Secretos, llaves de API y servidor MCP del workspace</p></div></div>

      <div class="stack">
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

        <nx-api-keys />
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
  secretName = '';
  secretValue = '';
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
    this.secrets.set(await this.api.secrets());
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

  copy(text: string) {
    void navigator.clipboard?.writeText(text);
    this.toast.info('Copiado al portapapeles');
  }
}
