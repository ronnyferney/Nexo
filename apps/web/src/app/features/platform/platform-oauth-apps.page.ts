import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.service';
import { PlatformApi } from '../../core/platform.api';
import type { PlatformOAuthProvider } from '../../core/platform.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { PlatformNavComponent } from './platform-nav.component';

/**
 * Consola de plataforma → Apps de inicio de sesión. Un administrador de Nexo configura una sola vez la app OAuth de
 * cada proveedor (Microsoft 365, Google…); después todos los clientes conectan sus cuentas con un clic, sin ver nada
 * técnico. El secreto se guarda cifrado y nunca se devuelve.
 */
@Component({
  selector: 'nx-platform-oauth-apps',
  imports: [FormsModule, IconComponent, PlatformNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="head"><h1>Apps de inicio de sesión</h1>
        <p class="muted">Configure una sola vez la app de cada proveedor. Después, cualquier cliente conecta Microsoft 365,
          Google y las demás con un clic, sin registrar nada ni copiar claves.</p></header>
      <nx-platform-nav />

      @if (loading()) { <p class="muted" role="status">Cargando…</p> }
      @else if (error()) { <div class="callout danger" role="alert"><span class="grow">{{ error() }}</span>
        <button class="btn sm" (click)="load()">Reintentar</button></div> }
      @else {
        <ul class="apps">
          @for (p of providers(); track p.provider) {
            <li class="card">
              <div class="row">
                <div class="grow">
                  <div class="title"><strong>{{ p.label }}</strong>
                    @if (p.configured) { <span class="badge success"><nx-icon name="check" [size]="12" />Configurada@if (p.source === 'env') { (por variables) }</span> }
                    @else { <span class="badge warning">Sin configurar</span> }
                  </div>
                  @if (p.configured && p.clientIdHint) { <span class="muted small">client ID <code>{{ p.clientIdHint }}</code></span> }
                  <span class="muted small block">La usan: {{ p.integrations.join(', ') || '—' }}</span>
                </div>
                <button class="btn sm" (click)="toggle(p.provider)">{{ open() === p.provider ? 'Cerrar' : p.configured ? 'Cambiar' : 'Configurar' }}</button>
              </div>

              @if (open() === p.provider) {
                <div class="form">
                  <div class="callout info"><nx-icon name="info" [size]="16" />
                    <div><p>Registre una app en el proveedor con esta <strong>URL de redirección</strong> y copie su client ID y secreto:</p>
                      <code class="redirect">{{ p.redirectUri }}</code>
                      <button type="button" class="link" (click)="copy(p.redirectUri)">Copiar</button>
                      @if (p.scopes.length) { <p class="small">Permisos a conceder: {{ p.scopes.join(', ') }}.</p> }
                    </div></div>
                  <label>Client ID
                    <input class="input" [(ngModel)]="clientId" autocomplete="off" placeholder="Id. de aplicación (cliente)" /></label>
                  <label>Client secret
                    <input class="input mono" type="password" [(ngModel)]="clientSecret" autocomplete="new-password" placeholder="Valor del secreto" /></label>
                  <div class="actions">
                    <button class="btn primary" [disabled]="busy() || !clientId.trim() || !clientSecret.trim()" (click)="save(p.provider)">
                      {{ busy() ? 'Guardando…' : 'Guardar' }}</button>
                    @if (p.configured && p.source === 'console') {
                      <button class="btn danger ghost" [disabled]="busy()" (click)="remove(p.provider)">Quitar</button>
                    }
                  </div>
                </div>
              }
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .page { max-width: 820px; }
    .head h1 { margin-bottom: 4px; }
    .apps { list-style: none; margin: 16px 0 0; padding: 0; display: grid; gap: 12px; }
    .card { border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; }
    .row { display: flex; gap: 12px; align-items: center; }
    .grow { flex: 1; min-width: 0; }
    .title { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .block { display: block; margin-top: 2px; }
    .form { margin-top: 14px; display: grid; gap: 12px; }
    .form label { display: grid; gap: 4px; font-size: 13px; font-weight: 600; }
    .redirect { display: inline-block; margin: 6px 8px 6px 0; padding: 4px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; overflow-wrap: anywhere; }
    .link { background: none; border: 0; padding: 0; color: var(--primary); cursor: pointer; text-decoration: underline; font: inherit; }
    .actions { display: flex; gap: 10px; }
  `,
})
export class PlatformOAuthAppsPage {
  private readonly api = inject(PlatformApi);
  private readonly toast = inject(ToastService);

  readonly providers = signal<PlatformOAuthProvider[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly open = signal<string | null>(null);
  readonly busy = signal(false);
  clientId = '';
  clientSecret = '';

  constructor() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.providers.set(await this.api.oauthApps());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  toggle(provider: string) {
    this.clientId = '';
    this.clientSecret = '';
    this.open.set(this.open() === provider ? null : provider);
  }

  async copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.toast.success('URL de redirección copiada');
    } catch {
      this.toast.error('No se pudo copiar');
    }
  }

  async save(provider: string) {
    this.busy.set(true);
    try {
      await this.api.saveOAuthApp(provider, this.clientId.trim(), this.clientSecret.trim());
      this.toast.success('App configurada. Los clientes ya pueden conectar con un clic.');
      this.open.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async remove(provider: string) {
    if (!confirm('¿Quitar la app? Los clientes dejarán de poder conectar este proveedor hasta configurarla de nuevo.')) return;
    this.busy.set(true);
    try {
      await this.api.removeOAuthApp(provider);
      this.toast.success('App eliminada');
      this.open.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
