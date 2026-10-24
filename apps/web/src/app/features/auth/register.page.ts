import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { IconComponent } from '../../shared/icon.component';
import { AUTH_BRAND_COMPACT, AUTH_HERO, AUTH_STYLES } from './auth.styles';

@Component({
  selector: 'nx-register',
  imports: [FormsModule, RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: AUTH_STYLES,
  template: `
    ${AUTH_HERO}
    <section class="form-side">
      <form (ngSubmit)="submit()">
        ${AUTH_BRAND_COMPACT}
        <div><h1>Crear cuenta</h1><p class="muted">Empiece a automatizar en minutos</p></div>
        @if (closed()) {
          <div class="callout info" role="status"><nx-icon name="info" [size]="16" />
            <span>El registro público está cerrado. Para entrar a Nexo, pida una invitación al administrador de su empresa y abra el enlace que reciba.</span></div>
          <p class="muted small">¿Ya tiene cuenta? <a routerLink="/login">Iniciar sesión</a></p>
        } @else {
        <div class="field"><label for="reg-name">Nombre</label><input id="reg-name" class="input" name="name" [(ngModel)]="name" required autocomplete="name" /></div>
        <div class="field"><label for="reg-ws">Empresa o espacio de trabajo</label><input id="reg-ws" class="input" name="ws" autocomplete="organization" [(ngModel)]="workspaceName" placeholder="Mi empresa" /></div>
        <div class="field"><label for="reg-email">Correo</label><input id="reg-email" class="input" type="email" name="email" [(ngModel)]="email" required autocomplete="email" /></div>
        <div class="field"><label for="reg-password">Contraseña</label><input id="reg-password" class="input" type="password" name="password" [(ngModel)]="password" required minlength="8" autocomplete="new-password" aria-describedby="reg-password-hint" />
          <span class="hint" id="reg-password-hint">Mínimo 8 caracteres</span></div>
        @if (error()) { <div class="error-text" role="alert">{{ error() }}</div> }
        <button class="btn primary" type="submit" [disabled]="loading()">{{ loading() ? 'Creando…' : 'Crear cuenta' }}</button>
        <p class="muted small">¿Ya tiene cuenta? <a routerLink="/login">Iniciar sesión</a></p>
        }
      </form>
    </section>
  `,
})
export class RegisterPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  name = '';
  workspaceName = '';
  email = '';
  password = '';
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly closed = signal(false);

  ngOnInit() {
    void this.auth
      .config()
      .then((c) => this.closed.set(c.registrationMode !== 'open'))
      .catch(() => undefined);
  }

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
