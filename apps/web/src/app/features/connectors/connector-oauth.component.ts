import { ChangeDetectionStrategy, Component, computed, DOCUMENT, inject, input, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { IntegrationsApi } from '../../core/integrations.api';
import type { OAuthStatus } from '../../core/integrations.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { isHttpUrl } from '../../shared/safe-url';

/** Tarjeta «Cuenta conectada» de un conector con OAuth2 de usuario (ADR 0005 D3). */
@Component({
  selector: 'nx-connector-oauth',
  imports: [IconComponent, RelativeTimePipe, DatePipe],
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
        @if (auth.canEdit()) {
          <div class="row wrap">
            <button class="btn" [class.primary]="!s.connected" [disabled]="busy()" (click)="connect()">
              <nx-icon [name]="s.connected ? 'refresh' : 'link'" [size]="16" />{{ busy() === 'start' ? 'Redirigiendo…' : s.connected ? 'Reconectar' : 'Conectar cuenta' }}</button>
            @if (s.connected) {
              <button class="btn danger" [disabled]="busy()" (click)="disconnect()"><nx-icon name="unlink" [size]="16" />{{ busy() === 'disconnect' ? 'Desconectando…' : 'Desconectar' }}</button>
            }
          </div>
        }
      }
    </section>
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

  async disconnect() {
    if (!confirm('¿Desconectar la cuenta? Se revocarán los tokens y los agentes y flujos que usan este conector dejarán de funcionar hasta reconectarla.'))
      return;
    this.busy.set('disconnect');
    try {
      await this.api.oauthDisconnect(this.connectorId());
      this.toast.success('Cuenta desconectada');
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }
}
