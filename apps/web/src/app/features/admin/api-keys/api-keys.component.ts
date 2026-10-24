import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../../core/api.service';
import { AuthService } from '../../../core/auth.service';
import type { ApiKey, ApiKeyExpiration, ApiKeyRole, ApiKeyScope } from '../../../core/models';
import { ToastService } from '../../../core/toast.service';
import { IconComponent } from '../../../shared/icon.component';
import { RelativeTimePipe } from '../../../shared/relative-time.pipe';
import {
  API_KEY_SCOPE_OPTIONS,
  apiKeyExpirationOptions,
  apiKeyRoleOptions,
  apiKeyScopeLabel,
  apiKeyStatusLabel,
  apiKeyWarnings,
} from './api-keys.meta';

/**
 * API keys del workspace (B3): alta con alcance, rol máximo y expiración; lista con último uso, avisos de rotación y
 * revocación. La llave completa solo se muestra una vez, al crearla.
 */
@Component({
  selector: 'nx-api-keys',
  imports: [FormsModule, DatePipe, IconComponent, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card stack">
      <div class="card-title">
        <div class="icon-tile"><nx-icon name="key" /></div>
        <div>
          <h2>API keys</h2>
          <p class="muted small">
            Para integraciones máquina a máquina y el servidor MCP. Dé a cada clave solo el alcance
            que necesita.
          </p>
        </div>
      </div>

      <form class="stack" (ngSubmit)="create()">
        <div class="field">
          <label for="ak-name">Nombre</label>
          <input
            id="ak-name"
            class="input"
            name="name"
            placeholder="Ej. Claude Desktop"
            maxlength="60"
            [(ngModel)]="name"
          />
        </div>
        <fieldset class="field" style="border:0; padding:0; margin:0">
          <legend class="small"><strong>Alcance</strong></legend>
          <div class="checklist">
            @for (o of scopeOptions; track o.value) {
              <label class="choice">
                <input
                  type="checkbox"
                  [name]="'scope-' + o.value"
                  [ngModel]="scopes().includes(o.value)"
                  (ngModelChange)="toggleScope(o.value, $event)"
                />
                <span
                  ><strong class="small">{{ o.label }}</strong>
                  <code class="small muted">{{ o.value }}</code>
                  <div class="muted small">{{ o.hint }}</div></span
                >
              </label>
            }
          </div>
        </fieldset>
        <div class="row wrap">
          <div class="field">
            <label for="ak-role">Rol máximo</label>
            <select id="ak-role" class="input" name="role" [(ngModel)]="role">
              @for (r of roleOptions(); track r) {
                <option [value]="r">{{ r }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label for="ak-exp">Expiración</label>
            <select id="ak-exp" class="input" name="expiration" [(ngModel)]="expiration">
              @for (o of expirationOptions(); track o.value) {
                <option [value]="o.value">{{ o.label }}</option>
              }
            </select>
          </div>
        </div>
        @if (expiration === 'never') {
          <div class="callout warning" role="note">
            <nx-icon name="alert" [size]="16" /><span
              >Una clave sin expiración sigue valiendo hasta que la revoque. Prefiera una expiración
              y rótela.</span
            >
          </div>
        }
        <p class="muted small">
          La clave nunca tendrá más permisos que usted: si su rol cambia, la clave queda limitada a
          su nuevo rol.
        </p>
        <div>
          <button class="btn primary" type="submit" [disabled]="!canCreate() || creating()">
            {{ creating() ? 'Creando…' : 'Crear API key' }}
          </button>
        </div>
      </form>

      @if (newKey()) {
        <div class="callout warning" role="status">
          <div class="stack" style="width:100%">
            <strong class="small">Copie la llave ahora; no volverá a mostrarse.</strong>
            <div class="row">
              <input
                class="input mono small"
                readonly
                aria-label="Nueva API key"
                [value]="newKey()"
              />
              <button class="btn icon" type="button" aria-label="Copiar" (click)="copy(newKey()!)">
                <nx-icon name="copy" [size]="15" />
              </button>
            </div>
          </div>
        </div>
      }

      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Alcance</th>
              <th>Rol</th>
              <th>Expira</th>
              <th>Último uso</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (k of keys(); track k.id) {
              <tr>
                <td>
                  <strong>{{ k.name }}</strong>
                  <div class="mono small muted">{{ k.prefix }}…</div>
                  @if (k.createdBy) {
                    <div class="muted small">por {{ k.createdBy.name }}</div>
                  }
                </td>
                <td>
                  <span class="chips">
                    @for (s of k.scopes; track s) {
                      <span class="badge" [class.warning]="s === '*'">{{ scopeLabel(s) }}</span>
                    }
                  </span>
                </td>
                <td class="small">{{ k.role }}</td>
                <td class="small nowrap">
                  @if (k.expiresAt) {
                    {{ k.expiresAt | date: 'mediumDate' }}
                  } @else {
                    <span class="badge warning">Sin expiración</span>
                  }
                </td>
                <td class="muted small nowrap">
                  {{ k.lastUsedAt ? (k.lastUsedAt | ago) : 'Nunca' }}
                </td>
                <td>
                  <span [class]="'badge ' + status(k).tone">{{ status(k).text }}</span>
                  @for (w of warnings(k); track w) {
                    <div class="muted small" style="max-width:260px">{{ w }}</div>
                  }
                </td>
                <td style="text-align:right">
                  @if (k.status !== 'REVOKED') {
                    <button
                      class="btn ghost sm danger"
                      type="button"
                      [attr.aria-label]="'Revocar ' + k.name"
                      (click)="revoke(k)"
                    >
                      <nx-icon name="trash" [size]="14" /> Revocar
                    </button>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td class="muted" colspan="7">Sin API keys.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class ApiKeysComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  readonly scopeOptions = API_KEY_SCOPE_OPTIONS;
  readonly keys = signal<ApiKey[]>([]);
  readonly newKey = signal<string | null>(null);
  readonly creating = signal(false);
  readonly scopes = signal<ApiKeyScope[]>([]);
  readonly roleOptions = computed(() => apiKeyRoleOptions(this.auth.session()?.role));
  readonly expirationOptions = computed(() => apiKeyExpirationOptions(this.auth.session()?.role));
  readonly canCreate = computed(() => this.scopes().length > 0);
  name = '';
  role: ApiKeyRole = 'EDITOR';
  expiration: ApiKeyExpiration = '90d';

  readonly scopeLabel = apiKeyScopeLabel;
  readonly status = apiKeyStatusLabel;
  readonly warnings = (k: ApiKey) => apiKeyWarnings(k);

  async ngOnInit() {
    await this.load();
  }

  async load() {
    try {
      this.keys.set(await this.api.apiKeys());
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  toggleScope(scope: ApiKeyScope, on: boolean) {
    this.scopes.update((list) =>
      on ? [...new Set([...list, scope])] : list.filter((s) => s !== scope),
    );
  }

  async create() {
    const name = this.name.trim();
    if (name.length < 2) {
      this.toast.error('Indique un nombre de al menos 2 caracteres');
      return;
    }
    this.creating.set(true);
    try {
      const created = await this.api.createApiKey({
        name,
        scopes: this.scopes(),
        role: this.role,
        expiration: this.expiration,
      });
      this.newKey.set(created.key);
      this.name = '';
      this.scopes.set([]);
      this.expiration = '90d';
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.creating.set(false);
    }
  }

  async revoke(k: ApiKey) {
    if (
      !confirm(
        `¿Revocar «${k.name}»? Las integraciones que la usan dejarán de funcionar de inmediato.`,
      )
    )
      return;
    try {
      await this.api.revokeApiKey(k.id);
      this.toast.success('API key revocada');
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  copy(text: string) {
    void navigator.clipboard?.writeText(text);
    this.toast.info('Copiado al portapapeles');
  }
}
