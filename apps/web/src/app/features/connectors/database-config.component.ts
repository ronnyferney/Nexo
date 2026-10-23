import { ChangeDetectionStrategy, Component, computed, inject, input, model, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { IntegrationsApi } from '../../core/integrations.api';
import type { DatabaseConfig, DatabaseEngine, EdgeOption } from '../../core/integrations.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { TemplateRefPipe } from '../../shared/template-ref.pipe';
import { DB_ENGINES } from './connector-presets';

const SECRET_REF = /^\{\{\s*secrets\.[A-Za-z0-9_]+\s*\}\}$/;

/** Configuración de un conector `DATABASE`: motor, modo directo / Nexo Edge y escrituras (ADR 0005 D4-D5). */
@Component({
  selector: 'nx-database-config',
  imports: [FormsModule, RouterLink, IconComponent, TemplateRefPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let c = config();
    <div class="field"><label for="db-engine">Motor</label>
      <select id="db-engine" class="input" [ngModel]="c.engine" (ngModelChange)="setEngine($event)">
        @for (e of engines; track e.value) { <option [value]="e.value">{{ e.label }}</option> }
      </select></div>

    <fieldset class="modes">
      <legend>Modo de conexión</legend>
      <label class="choice"><input type="radio" name="db-mode" value="direct" [ngModel]="c.mode" (ngModelChange)="patch({ mode: $event })" />
        <span><strong>Directo</strong><span class="muted small block">La base está en la nube y es accesible desde internet con TLS y una lista de IPs permitidas para Nexo.</span></span></label>
      <label class="choice"><input type="radio" name="db-mode" value="edge" [ngModel]="c.mode" (ngModelChange)="patch({ mode: $event })" />
        <span><strong>A través de Nexo Edge</strong><span class="muted small block">La base está en su red privada u on-premise. El Edge corre en su red,
          se conecta hacia Nexo por una conexión saliente y las credenciales nunca salen de su red.</span></span></label>
    </fieldset>

    @if (c.mode === 'edge') {
      @if (edgesLoading()) {
        <p class="muted small" role="status">Cargando Edge registrados…</p>
      } @else if (edgesError()) {
        <div class="callout danger" role="alert"><span class="grow">No se pudieron cargar los Edge: {{ edgesError() }}</span>
          <button type="button" class="btn sm" (click)="loadEdges()">Reintentar</button></div>
      } @else if (!edges().length) {
        <div class="callout warning"><nx-icon name="server" [size]="16" />
          <span>No hay ningún Nexo Edge registrado.
            @if (auth.isAdmin()) { <a routerLink="/admin/edges">Registre uno en Administración → Nexo Edge</a>. } @else { Pida a un administrador que registre uno. }</span></div>
      } @else {
        <div class="field"><label for="db-edge">Nexo Edge</label>
          <select id="db-edge" class="input" [ngModel]="c.edgeId ?? ''" (ngModelChange)="patch({ edgeId: $event, connectionKey: '' })">
            <option value="" disabled>Seleccione un Edge…</option>
            @for (e of edges(); track e.id) { <option [value]="e.id">{{ e.name }} — {{ e.status === 'ONLINE' ? 'en línea' : 'fuera de línea' }}</option> }
          </select>
          @if (edge(); as e) {
            <span class="presence" [class.online]="e.status === 'ONLINE'" [class.offline]="e.status !== 'ONLINE'">{{ e.status === 'ONLINE' ? 'En línea' : 'Fuera de línea' }}</span>
          }
        </div>
        @if (edge(); as e) {
          <div class="field"><label for="db-conn">Clave de conexión</label>
            @if (e.connections.length) {
              <select id="db-conn" class="input mono" [ngModel]="c.connectionKey ?? ''" (ngModelChange)="patch({ connectionKey: $event })">
                <option value="" disabled>Seleccione una conexión…</option>
                @for (k of connectionOptions(); track k) { <option [value]="k">{{ k }}</option> }
              </select>
              <span class="hint">Conexiones declaradas en el <code>edge.yaml</code> de «{{ e.name }}». Las credenciales viven solo en ese archivo.</span>
            } @else {
              <input id="db-conn" class="input mono" placeholder="astrans" [ngModel]="c.connectionKey ?? ''" (ngModelChange)="patch({ connectionKey: $event })" aria-describedby="db-conn-h" />
              <span class="hint" id="db-conn-h">Este Edge aún no ha declarado conexiones{{ e.status !== 'ONLINE' ? ' (está fuera de línea)' : '' }}. Escriba la clave tal como aparece en <code>edge.yaml</code>.</span>
            }
          </div>
        }
      }
    } @else {
      <div class="grid host">
        <div class="field"><label for="db-host">Host</label><input id="db-host" class="input mono" placeholder="db.ejemplo.com" [ngModel]="c.host ?? ''" (ngModelChange)="patch({ host: $event })" /></div>
        <div class="field"><label for="db-port">Puerto</label><input id="db-port" class="input" type="number" min="1" max="65535" [ngModel]="c.port" (ngModelChange)="patch({ port: $event })" /></div>
      </div>
      <div class="grid grid-2">
        <div class="field"><label for="db-name">Base de datos</label><input id="db-name" class="input mono" [ngModel]="c.database ?? ''" (ngModelChange)="patch({ database: $event })" /></div>
        <div class="field"><label for="db-user">Usuario</label><input id="db-user" class="input mono" autocomplete="off" [ngModel]="c.user ?? ''" (ngModelChange)="patch({ user: $event })" /></div>
      </div>
      <div class="field"><label for="db-pass">Contraseña (referencia a secreto)</label>
        <div class="row">
          <input id="db-pass" class="input mono" list="db-secrets" autocomplete="off" spellcheck="false" [class.invalid]="passwordInvalid()"
            [placeholder]="'secrets.DB_PASSWORD' | tpl" [ngModel]="c.password ?? ''" (ngModelChange)="patch({ password: $event })" aria-describedby="db-pass-h" />
          @if (auth.isAdmin()) {
            <button type="button" class="btn" [attr.aria-expanded]="creatingSecret()" aria-controls="db-new-secret" (click)="toggleSecretForm()"><nx-icon name="key" [size]="16" />Crear secreto</button>
          }
        </div>
        <datalist id="db-secrets">@for (s of secretNames(); track s) { <option [value]="'secrets.' + s | tpl"></option> }</datalist>
        @if (passwordInvalid()) {
          <span class="error-text" id="db-pass-h">Use una referencia a la bóveda, por ejemplo <code>{{ 'secrets.DB_PASSWORD' | tpl }}</code>; nunca la contraseña en claro.</span>
        } @else {
          <span class="hint" id="db-pass-h">La contraseña se guarda cifrada en la bóveda; aquí solo va su referencia.</span>
        }
      </div>
      @if (creatingSecret()) {
        <div class="new-secret stack" id="db-new-secret">
          <div class="grid grid-2">
            <div class="field"><label for="ns-name">Nombre del secreto</label><input id="ns-name" class="input mono" [(ngModel)]="secretName" /></div>
            <div class="field"><label for="ns-value">Contraseña</label><input id="ns-value" class="input mono" type="password" autocomplete="new-password" [(ngModel)]="secretValue" /></div>
          </div>
          <div class="row"><span class="spacer"></span>
            <button type="button" class="btn sm" (click)="creatingSecret.set(false)">Cancelar</button>
            <button type="button" class="btn sm primary" [disabled]="savingSecret() || !validSecretName() || !secretValue" (click)="saveSecret()">{{ savingSecret() ? 'Guardando…' : 'Guardar y usar' }}</button></div>
        </div>
      }
      <label class="checkbox"><input type="checkbox" [ngModel]="!!c.ssl" (ngModelChange)="patch({ ssl: $event })" />Usar TLS/SSL (recomendado)</label>
    }

    <div class="divider"></div>
    <label class="checkbox"><input type="checkbox" [ngModel]="!!c.allowWrites" (ngModelChange)="patch({ allowWrites: $event })" aria-describedby="db-writes-h" />
      <strong>Permitir escrituras</strong></label>
    @if (c.allowWrites) {
      <div class="callout warning" id="db-writes-h" role="note"><nx-icon name="alert" [size]="16" />
        <span>Las operaciones en modo escritura podrán modificar datos. Prefiera procedimientos almacenados, use un usuario con permisos mínimos
          y exija aprobación humana en los agentes.{{ c.mode === 'edge' ? ' El edge.yaml también debe permitirlo (allowWrites: true).' : '' }}</span></div>
    } @else {
      <span class="hint" id="db-writes-h">Desactivado: solo se ejecutan consultas de lectura (<code>SELECT</code>/<code>WITH</code>) en transacciones de solo lectura.</span>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 12px; }
    .modes { border: 0; margin: 0; padding: 0; display: grid; gap: 8px; }
    .modes legend { font-size: 12.5px; font-weight: 600; color: var(--muted); margin-bottom: 6px; padding: 0; }
    .host { grid-template-columns: minmax(0, 1fr) 110px; }
    .grow { flex: 1; min-width: 0; }
    .row .input { flex: 1; min-width: 0; }
    .new-secret { padding: 12px; border: 1px dashed var(--border); border-radius: 10px; background: var(--surface-2); }
    .hint, .error-text { font-size: 12px; }
    @media (max-width: 480px) { .host { grid-template-columns: 1fr; } .row:has(#db-pass) { flex-wrap: wrap; } }
  `,
})
export class DatabaseConfigComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly integrations = inject(IntegrationsApi);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);

  readonly config = model.required<DatabaseConfig>();
  readonly connectorName = input('');

  readonly engines = DB_ENGINES;
  readonly edges = signal<EdgeOption[]>([]);
  readonly edgesLoading = signal(true);
  readonly edgesError = signal<string | null>(null);
  readonly secretNames = signal<string[]>([]);
  readonly creatingSecret = signal(false);
  readonly savingSecret = signal(false);
  secretName = '';
  secretValue = '';

  readonly edge = computed(() => this.edges().find((e) => e.id === this.config().edgeId) ?? null);
  /** Incluye la clave guardada aunque el Edge ya no la declare, para no perderla al editar. */
  readonly connectionOptions = computed(() => {
    const keys = this.edge()?.connections ?? [];
    const current = this.config().connectionKey;
    return current && !keys.includes(current) ? [current, ...keys] : keys;
  });
  readonly passwordInvalid = computed(() => {
    const p = this.config().password;
    return !!p && !SECRET_REF.test(p.trim());
  });

  async ngOnInit() {
    await Promise.all([this.loadEdges(), this.loadSecrets()]);
  }

  async loadEdges() {
    this.edgesLoading.set(true);
    this.edgesError.set(null);
    try {
      this.edges.set(await this.integrations.edges());
    } catch (e) {
      this.edgesError.set(errorMessage(e));
    } finally {
      this.edgesLoading.set(false);
    }
  }

  private async loadSecrets() {
    try {
      this.secretNames.set((await this.api.secrets()).map((s) => s.name));
    } catch {
      // Las sugerencias son opcionales: si falla, el usuario puede escribir la referencia.
    }
  }

  patch(p: Partial<DatabaseConfig>) {
    this.config.update((c) => ({ ...c, ...p }));
  }

  setEngine(engine: DatabaseEngine) {
    const prev = DB_ENGINES.find((e) => e.value === this.config().engine);
    const next = DB_ENGINES.find((e) => e.value === engine)!;
    const port = this.config().port;
    this.patch({ engine, ...(!port || port === prev?.port ? { port: next.port } : {}) });
  }

  toggleSecretForm() {
    if (!this.creatingSecret()) {
      const slug = (this.connectorName() || 'DB').toUpperCase().normalize('NFD').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      this.secretName = `${slug || 'DB'}_PASSWORD`;
      this.secretValue = '';
    }
    this.creatingSecret.update((v) => !v);
  }

  validSecretName() {
    return /^[A-Za-z0-9_]{2,}$/.test(this.secretName.trim());
  }

  async saveSecret() {
    const name = this.secretName.trim().toUpperCase();
    this.savingSecret.set(true);
    try {
      await this.api.upsertSecret(name, this.secretValue);
      this.secretValue = '';
      this.patch({ password: `{{ secrets.${name} }}` });
      this.secretNames.update((s) => (s.includes(name) ? s : [...s, name]));
      this.creatingSecret.set(false);
      this.toast.success(`Secreto ${name} guardado. Recuerde guardar el conector.`);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.savingSecret.set(false);
    }
  }
}
