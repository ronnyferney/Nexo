import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { BuildInfo } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

/**
 * Mi cuenta: datos del usuario, cambio de contraseña (obligatorio para el usuario maestro al primer ingreso) y versión
 * de la plataforma para soporte.
 */
@Component({
  selector: 'nx-account',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Mi cuenta</h1><p>Sus datos de acceso a Nexo</p></div></div>

      @if (auth.me(); as me) {
        <div class="card" style="max-width:760px; margin-bottom:16px">
          <div class="card-title" style="margin:0"><div class="icon-tile"><nx-icon name="user" /></div>
            <div><h2>{{ me.name }}</h2><p class="muted small">{{ me.email }}</p></div><span class="spacer"></span>
            @if (me.emailVerifiedAt) {
              <span class="badge success">Correo verificado</span>
            } @else {
              <span class="badge warning">Correo sin verificar</span>
            }</div>
          @if (!me.emailVerifiedAt) {
            <div class="callout info" style="margin-top:12px"><nx-icon name="info" [size]="16" />
              <span>Verifique su correo para que otras empresas puedan invitarle con esta cuenta.
                <button type="button" class="btn sm" [disabled]="verifying()" (click)="requestVerification()">Enviarme el enlace</button></span></div>
          }
        </div>
      }

      <form class="card stack" style="max-width:760px" (ngSubmit)="save()" #f="ngForm">
        <div class="card-title"><div class="icon-tile"><nx-icon name="key" /></div>
          <div><h2>Cambiar contraseña</h2><p class="muted small">Mínimo 8 caracteres; se recomiendan 12 o más</p></div></div>
        <div class="field"><label for="current">Contraseña actual</label>
          <input class="input" id="current" type="password" name="current" [(ngModel)]="current" required
            autocomplete="current-password" /></div>
        <div class="field"><label for="next">Nueva contraseña</label>
          <input class="input" id="next" type="password" name="next" [(ngModel)]="next" required minlength="8"
            maxlength="128" autocomplete="new-password" /></div>
        <div class="field"><label for="confirm">Confirmar nueva contraseña</label>
          <input class="input" id="confirm" type="password" name="confirm" [(ngModel)]="confirm" required
            autocomplete="new-password" /></div>
        @if (confirm && next !== confirm) {
          <p class="error-text" role="alert">Las contraseñas no coinciden</p>
        }
        <div class="row">
          <button class="btn primary" type="submit"
            [disabled]="saving() || !f.valid || next !== confirm"><nx-icon name="save" />Guardar contraseña</button>
        </div>
      </form>

      <section class="card stack about" aria-labelledby="about-title">
        <div class="card-title" style="margin:0"><div class="icon-tile"><nx-icon name="info" /></div>
          <div><h2 id="about-title">Acerca de Nexo</h2><p class="muted small">Indique estos datos al contactar a soporte</p></div></div>
        @if (versionError()) {
          <p class="muted small" role="alert">No se pudo consultar la versión de la plataforma. {{ versionError() }}
            <button type="button" class="btn sm" (click)="loadVersion()">Reintentar</button></p>
        } @else if (version(); as v) {
          <dl class="kv small">
            <dt>Versión</dt><dd><code>{{ v.version }}</code></dd>
            <dt>Commit</dt><dd><code>{{ v.commit ? v.commit.slice(0, 12) : 'No disponible' }}</code></dd>
            <dt>Compilada</dt><dd>{{ v.builtAt ? fmt(v.builtAt) : 'No disponible' }}</dd>
          </dl>
          <div class="row"><button type="button" class="btn sm" (click)="copyVersion(v)"><nx-icon name="copy" [size]="14" />Copiar datos de versión</button></div>
        } @else {
          <p class="muted small" role="status">Consultando versión…</p>
        }
      </section>
    </div>
  `,
  styles: `
    .about { max-width: 760px; margin-top: 16px; }
    .kv { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; }
    .kv dt { color: var(--muted); }
    .kv dd { margin: 0; overflow-wrap: anywhere; }
  `,
})
export class AccountPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  readonly saving = signal(false);
  readonly verifying = signal(false);
  readonly version = signal<BuildInfo | null>(null);
  readonly versionError = signal<string | null>(null);
  current = '';
  next = '';
  confirm = '';

  ngOnInit() {
    void this.loadVersion();
  }

  async loadVersion() {
    this.versionError.set(null);
    try {
      this.version.set(await this.api.version());
    } catch (e) {
      this.versionError.set(errorMessage(e));
    }
  }

  fmt(iso: string) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
  }

  async copyVersion(v: BuildInfo) {
    const text = `Nexo ${v.version}${v.commit ? ` (${v.commit})` : ''}${v.builtAt ? ` · ${v.builtAt}` : ''}`;
    try {
      await navigator.clipboard.writeText(text);
      this.toast.success('Datos de versión copiados');
    } catch {
      this.toast.error('No se pudo copiar; seleccione el texto manualmente');
    }
  }

  async requestVerification() {
    this.verifying.set(true);
    try {
      const res = await this.api.requestEmailVerification();
      if (res.alreadyVerified) {
        this.toast.success('Su correo ya estaba verificado');
        await this.auth.loadMe();
      } else if (res.sent) {
        this.toast.success('Le enviamos un enlace de verificación a su correo');
      } else {
        this.toast.error('No se pudo enviar el correo; intente más tarde');
      }
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.verifying.set(false);
    }
  }

  async save() {
    if (this.next !== this.confirm) return;
    this.saving.set(true);
    try {
      // Cambiar la contraseña cierra las demás sesiones: se adopta el token nuevo que devuelve la API.
      this.auth.adopt(await this.api.changePassword({ currentPassword: this.current, newPassword: this.next }));
      this.current = this.next = this.confirm = '';
      this.toast.success('Contraseña actualizada; se cerraron sus otras sesiones');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
