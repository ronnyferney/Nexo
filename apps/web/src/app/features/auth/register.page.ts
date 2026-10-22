import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { AUTH_HERO, AUTH_STYLES } from './auth.styles';

@Component({
  selector: 'nx-register',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: AUTH_STYLES,
  template: `
    ${AUTH_HERO}
    <section class="form-side">
      <form (ngSubmit)="submit()">
        <div><h1>Crear cuenta</h1><p class="muted">Empiece a automatizar en minutos</p></div>
        <div class="field"><label>Nombre</label><input class="input" name="name" [(ngModel)]="name" required /></div>
        <div class="field"><label>Empresa / workspace</label><input class="input" name="ws" [(ngModel)]="workspaceName" placeholder="Mi empresa" /></div>
        <div class="field"><label>Correo</label><input class="input" type="email" name="email" [(ngModel)]="email" required /></div>
        <div class="field"><label>Contraseña</label><input class="input" type="password" name="password" [(ngModel)]="password" required minlength="8" />
          <span class="hint">Mínimo 8 caracteres</span></div>
        @if (error()) { <div class="error-text">{{ error() }}</div> }
        <button class="btn primary" type="submit" [disabled]="loading()">{{ loading() ? 'Creando…' : 'Crear cuenta' }}</button>
        <p class="muted small">¿Ya tiene cuenta? <a routerLink="/login">Iniciar sesión</a></p>
      </form>
    </section>
  `,
})
export class RegisterPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  name = '';
  workspaceName = '';
  email = '';
  password = '';
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  async submit() {
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.auth.register({ name: this.name, email: this.email, password: this.password, workspaceName: this.workspaceName || undefined });
      await this.router.navigate(['/']);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
