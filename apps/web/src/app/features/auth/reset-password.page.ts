import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { IconComponent } from '../../shared/icon.component';
import { AUTH_BRAND_COMPACT, AUTH_HERO, AUTH_STYLES } from './auth.styles';

/**
 * Elegir la contraseña nueva con el enlace recibido (`/restablecer/:token`). El enlace sirve una vez y vence a los
 * 30 minutos; al restablecer se cierran todas las sesiones, así que después se inicia sesión de nuevo.
 */
@Component({
  selector: 'nx-reset-password',
  imports: [FormsModule, RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: AUTH_STYLES,
  template: `
    ${AUTH_HERO}
    <section class="form-side">
      <form (ngSubmit)="submit()">
        ${AUTH_BRAND_COMPACT}
        <div>
          <h1>Elegir contraseña nueva</h1>
          <p class="muted">Al guardarla se cerrarán todas sus sesiones abiertas.</p>
        </div>
        @if (done()) {
          <div class="callout info" role="status">
            <nx-icon name="check" [size]="16" /><span
              >Su contraseña quedó restablecida. Inicie sesión con la nueva.</span
            >
          </div>
          @if (apiKeysRevoked()) {
            <div class="callout warning" role="note">
              <nx-icon name="alert" [size]="16" /><span
                >Por seguridad se revocaron {{ apiKeysRevoked() }} API key(s) creadas antes de que
                usted verificara el correo de esta cuenta.</span
              >
            </div>
          }
          <a class="btn primary" routerLink="/login">Iniciar sesión</a>
        } @else {
          <div class="field">
            <label for="rp-password">Contraseña nueva</label
            ><input
              id="rp-password"
              class="input"
              type="password"
              name="password"
              [(ngModel)]="password"
              required
              minlength="8"
              maxlength="128"
              autocomplete="new-password"
            />
          </div>
          <div class="field">
            <label for="rp-confirm">Repita la contraseña</label
            ><input
              id="rp-confirm"
              class="input"
              type="password"
              name="confirm"
              [(ngModel)]="confirm"
              required
              autocomplete="new-password"
            />
          </div>
          @if (error()) {
            <div class="error-text" role="alert">{{ error() }}</div>
          }
          <button class="btn primary" type="submit" [disabled]="loading()">
            {{ loading() ? 'Guardando…' : 'Guardar contraseña' }}
          </button>
          <p class="muted small">
            ¿El enlace venció? <a routerLink="/olvide-contrasena">Pida uno nuevo</a>.
          </p>
        }
      </form>
    </section>
  `,
})
export class ResetPasswordPage {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  password = '';
  confirm = '';
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly done = signal(false);
  readonly apiKeysRevoked = signal(0);

  async submit() {
    this.error.set(null);
    if (this.password.length < 8) {
      this.error.set('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    if (this.password !== this.confirm) {
      this.error.set('Las contraseñas no coinciden');
      return;
    }
    this.loading.set(true);
    try {
      const res = await this.auth.resetPassword(
        this.route.snapshot.paramMap.get('token') ?? '',
        this.password,
      );
      this.apiKeysRevoked.set(res.apiKeysRevoked);
      this.done.set(true);
      this.password = this.confirm = '';
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
