import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { IconComponent } from '../../shared/icon.component';
import { AUTH_BRAND_COMPACT, AUTH_HERO, AUTH_STYLES } from './auth.styles';

@Component({
  selector: 'nx-login',
  imports: [FormsModule, RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: AUTH_STYLES,
  template: `
    ${AUTH_HERO}
    <section class="form-side">
      <form (ngSubmit)="submit()">
        ${AUTH_BRAND_COMPACT}
        <div><h1>Iniciar sesión</h1><p class="muted">Le damos la bienvenida de nuevo a Nexo</p></div>
        <div class="field"><label for="login-email">Correo</label><input id="login-email" class="input" type="email" name="email" [(ngModel)]="email" required autocomplete="email" /></div>
        <div class="field"><label for="login-password">Contraseña</label><input id="login-password" class="input" type="password" name="password" [(ngModel)]="password" required autocomplete="current-password" /></div>
        @if (error()) { <div class="error-text" role="alert">{{ error() }}</div> }
        <button class="btn primary" type="submit" [disabled]="loading()">{{ loading() ? 'Ingresando…' : 'Ingresar' }}</button>
        <p class="muted small">¿No tiene cuenta? <a routerLink="/register">Crear cuenta</a></p>
      </form>
    </section>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  email = '';
  password = '';
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  async submit() {
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.auth.login(this.email, this.password);
      await this.router.navigate(['/']);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
