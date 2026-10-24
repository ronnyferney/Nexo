import { ChangeDetectionStrategy, Component, computed, DOCUMENT, inject, input, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { IntegrationsApi } from '../../core/integrations.api';
import type { ConnectorUsage, OAuthStatus } from '../../core/integrations.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { isHttpUrl } from '../../shared/safe-url';
import { AccountConfirmComponent } from '../integrations/account-confirm.component';

/** Tarjeta «Cuenta conectada» de un conector con OAuth2 de usuario (ADR 0005 D3). */
@Component({
  selector: 'nx-connector-oauth',
  imports: [IconComponent, RelativeTimePipe, DatePipe, AccountConfirmComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card stack" aria-labelledby="oauth-title" [attr.aria-busy]="loading()">
      <div class="row wrap">
        <div class="icon-tile"><nx-icon name="user" /></div>
        <div class="grow"><h2 id="oauth-title">Cuenta conectada</h2>
          <span class="muted small">Acceso delegado con OAuth2: Nexo actúa con los permisos que usted autorizó.</span></div>
        @if (status(); as s) {
          @if (s.connected) {
            <span class="badge" [class.success]="!expired()" [class.warning]="expired()"><span class="dot"></span>{{ expired() ? 'Token vencido' : 'Conectada' }}</span>
          } @else { <span class="badge warning"><span class="dot"></span>Sin conectar</span> }
        }
      </div>

      @if (loading()) {
        <p class="muted small" role="status">Consultando el estado de la cuenta…</p>
      } @else if (error()) {
        <div class="callout danger" role="alert"><span class="grow">No se pudo consultar la cuenta: {{ error() }}</span>
          <button class="btn sm" (click)="load()">Reintentar</button></div>
      } @else if (status(); as s) {
        @if (s.connected) {
          <dl class="meta">
            <div><dt>Cuenta</dt><dd>{{ s.accountLabel || '—' }}</dd></div>
            <div><dt>Expiración del token</dt><dd>@if (s.expiresAt) { <span [title]="s.expiresAt | date: 'medium'">{{ s.expiresAt | ago }}</span>
              <span class="muted small block">Se renueva automáticamente antes de vencer.</span> } @else { Sin expiración }</dd></div>
            <div class="wide"><dt>Permisos</dt><dd>
              @if (scopes().length) { <span class="chips">@for (sc of scopes(); track sc) { <code class="badge">{{ sc }}</code> }</span> } @else { — }</dd></div>
          </dl>
        } @else {
          <p class="muted small" style="margin:0">Conecte una cuenta para que los agentes y flujos puedan usar este conector.
            Lo llevaremos a la página del proveedor para que inicie sesión y autorice el acceso; luego volverá aquí.</p>
        }
        @if (s.app; as app) {
          @if (app.problem) {
            <div class="callout danger" role="alert"><nx-icon name="alert" [size]="16" />
              <span class="grow">No se puede iniciar sesión todavía: {{ app.problem }}</span></div>
          } @else {
            <p class="muted small" style="margin:0">
              App OAuth: <strong>{{ app.kind === 'own' ? 'propia del conector' : 'de la plataforma Nexo' }}</strong>
              · client ID <code>{{ app.clientIdHint }}</code>.
              Si el proveedor responde que la aplicación no existe, compare este client ID con el de su app registrada.</p>
          }
        }
        @if (auth.canEdit()) {
          <div class="row wrap">
            <button class="btn" [class.primary]="!s.connected" [disabled]="busy() || !!s.app?.problem" (click)="connect()">
              <nx-icon [name]="s.connected ? 'refresh' : 'link'" [size]="16" />{{ busy() === 'start' ? 'Redirigiendo…' : s.connected ? 'Reconectar' : 'Conectar cuenta' }}</button>
            @if (s.connected) {
              <button class="btn danger" [disabled]="busy()" (click)="disconnect()"><nx-icon name="unlink" [size]="16" />{{ busy() === 'disconnect' ? 'Desconectando…' : 'Desconectar' }}</button>
            }
          </div>
        }
      }
    </section>
    @if (confirming(); as c) {
      <nx-account-confirm [name]="status()?.accountLabel || 'la cuenta'" action="disconnect" [usage]="c.usage"
        [busy]="busy() === 'disconnect'" (confirmed)="doDisconnect()" (cancelled)="confirming.set(null)" />
    }
  `,
  styles: `
    .grow { flex: 1; min-width: 0; }
    .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 0; }
    .meta .wide { grid-column: 1 / -1; }
    dt { font-size: 12px; font-weight: 600; color: var(--muted); }
    dd { margin: 2px 0 0; overflow-wrap: anywhere; }
  `,
})
export class ConnectorOAuthComponent implements OnInit {
  private readonly api = inject(IntegrationsApi);
  private readonly toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);
  protected readonly auth = inject(AuthService);

  readonly connectorId = input.required<string>();
  readonly status = signal<OAuthStatus | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal<'start' | 'disconnect' | null>(null);

  readonly scopes = computed(() => (this.status()?.scope ?? '').split(/[\s,]+/).filter(Boolean));
  readonly expired = computed(() => {
    const at = this.status()?.expiresAt;
    return !!at && new Date(at).getTime() < Date.now();
  });

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.status.set(await this.api.oauthStatus(this.connectorId()));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async connect() {
    this.busy.set('start');
    try {
      const { authorizeUrl } = await this.api.oauthStart(this.connectorId());
      if (!isHttpUrl(authorizeUrl)) throw new Error('La API devolvió una URL de autorización no válida');
      this.document.location.assign(authorizeUrl);
    } catch (e) {
      this.toast.error(errorMessage(e));
      this.busy.set(null);
    }
  }

  /** Confirmación de desconexión con lo que deja de funcionar (null = consultando). */
  readonly confirming = signal<{ usage: ConnectorUsage | null } | null>(null);

  async disconnect() {
    this.confirming.set({ usage: null });
    try {
      this.confirming.set({ usage: await this.api.connectorUsage(this.connectorId()) });
    } catch (e) {
      this.confirming.set(null);
      this.toast.error(errorMessage(e));
    }
  }

  async doDisconnect() {
    this.busy.set('disconnect');
    try {
      await this.api.oauthDisconnect(this.connectorId());
      this.toast.success('Cuenta desconectada');
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(null);
      this.confirming.set(null);
    }
  }
}
