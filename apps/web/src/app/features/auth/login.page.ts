import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { AUTH_HERO, AUTH_STYLES } from './auth.styles';

@Component({
  selector: 'nx-login',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: AUTH_STYLES,
  template: `
    ${AUTH_HERO}
    <section class="form-side">
      <form (ngSubmit)="submit()">
        <div><h1>Iniciar sesión</h1><p class="muted">Bienvenido de nuevo a Nexo</p></div>
        <div class="field"><label>Correo</label><input class="input" type="email" name="email" [(ngModel)]="email" required autocomplete="email" /></div>
        <div class="field"><label>Contraseña</label><input class="input" type="password" name="password" [(ngModel)]="password" required autocomplete="current-password" /></div>
        @if (error()) { <div class="error-text">{{ error() }}</div> }
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
