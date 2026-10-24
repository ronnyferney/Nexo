import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
        @if (mailEnabled()) { <p class="muted small" style="margin:-8px 0 0"><a routerLink="/olvide-contrasena">¿Olvidó su contraseña?</a></p> }
        <button class="btn primary" type="submit" [disabled]="loading()">{{ loading() ? 'Ingresando…' : 'Ingresar' }}</button>
        @if (registrationOpen()) {
          <p class="muted small">¿No tiene cuenta? <a routerLink="/register">Crear cuenta</a></p>
        } @else {
          <p class="muted small">¿No tiene cuenta? Pida una invitación al administrador de su empresa.</p>
        }
      </form>
    </section>
  `,
})
export class LoginPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  email = '';
  password = '';
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly registrationOpen = signal(true);
  /** Sin correo saliente no hay recuperación por correo: el enlace se oculta. */
  readonly mailEnabled = signal(false);

  ngOnInit() {
    void this.auth
      .config()
      .then((c) => {
        this.registrationOpen.set(c.registrationMode === 'open');
        this.mailEnabled.set(c.mailEnabled);
      })
      .catch(() => undefined);
  }

  /** Solo rutas internas (`/…`, no `//host`): evita redirecciones abiertas tras iniciar sesión. */
  private returnUrl(): string {
    const url = this.route.snapshot.queryParamMap.get('returnUrl') ?? '';
    return url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\') ? url : '/';
  }

  async submit() {
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.auth.login(this.email, this.password);
      await this.router.navigateByUrl(this.returnUrl());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
