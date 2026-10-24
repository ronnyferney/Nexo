import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { IconComponent } from '../../shared/icon.component';
import { AUTH_BRAND_COMPACT, AUTH_HERO, AUTH_STYLES } from './auth.styles';

/**
 * Pedir el enlace de recuperación (`/olvide-contrasena`). La API responde lo mismo exista o no la cuenta, así que la
 * página siempre muestra el mismo mensaje. Sin correo saliente configurado no está disponible.
 */
@Component({
  selector: 'nx-forgot-password',
  imports: [FormsModule, RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: AUTH_STYLES,
  template: `
    ${AUTH_HERO}
    <section class="form-side">
      <form (ngSubmit)="submit()">
        ${AUTH_BRAND_COMPACT}
        <div>
          <h1>Recuperar contraseña</h1>
          <p class="muted">Le enviaremos un enlace para elegir una contraseña nueva.</p>
        </div>
        @if (mailEnabled() === false) {
          <div class="callout warning" role="note">
            <nx-icon name="alert" [size]="16" /><span
              >El envío de correos no está configurado en esta instalación. Pida a un administrador
              que le restablezca el acceso.</span
            >
          </div>
        } @else if (sent()) {
          <div class="callout info" role="status">
            <nx-icon name="check" [size]="16" /><span>{{ sent() }}</span>
          </div>
          <p class="muted small">
            ¿No llegó? Revise la carpeta de correo no deseado o vuelva a intentarlo en unos minutos.
          </p>
        } @else {
          <div class="field">
            <label for="fp-email">Correo</label
            ><input
              id="fp-email"
              class="input"
              type="email"
              name="email"
              [(ngModel)]="email"
              required
              autocomplete="email"
            />
          </div>
          @if (error()) {
            <div class="error-text" role="alert">{{ error() }}</div>
          }
          <button class="btn primary" type="submit" [disabled]="loading() || !email">
            {{ loading() ? 'Enviando…' : 'Enviar enlace' }}
          </button>
        }
        <p class="muted small"><a routerLink="/login">Volver a iniciar sesión</a></p>
      </form>
    </section>
  `,
})
export class ForgotPasswordPage implements OnInit {
  private readonly auth = inject(AuthService);
  email = '';
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly sent = signal<string | null>(null);
  readonly mailEnabled = signal<boolean | null>(null);

  ngOnInit() {
    void this.auth
      .config()
      .then((c) => this.mailEnabled.set(c.mailEnabled))
      .catch(() => undefined);
  }

  async submit() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.auth.forgotPassword(this.email.trim());
      this.sent.set(res.message);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
