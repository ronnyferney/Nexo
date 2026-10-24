import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { IconComponent } from '../../shared/icon.component';
import { AUTH_BRAND_COMPACT, AUTH_HERO, AUTH_STYLES } from './auth.styles';

/**
 * Confirmación del correo (`/verificar-correo/:token`, C1). La API exige la sesión de la misma cuenta además del
 * enlace: sin sesión se pide iniciarla y se vuelve aquí.
 */
@Component({
  selector: 'nx-verify-email',
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: AUTH_STYLES,
  template: `
    ${AUTH_HERO}
    <section class="form-side">
      <div class="stack" style="width:100%; max-width:380px">
        ${AUTH_BRAND_COMPACT}
        <h1>Verificar correo</h1>
        @if (state() === 'working') {
          <p class="muted" role="status">Verificando su correo…</p>
        } @else if (state() === 'done') {
          <div class="callout info" role="status"><nx-icon name="check" [size]="16" /><span>Su correo quedó verificado.</span></div>
          <a class="btn primary" routerLink="/account">Ir a Mi cuenta</a>
        } @else {
          <div class="error-text" role="alert">{{ error() }}</div>
          <p class="muted small">Si el enlace venció, solicite uno nuevo desde <a routerLink="/account">Mi cuenta</a>.</p>
        }
      </div>
    </section>
  `,
})
export class VerifyEmailPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly state = signal<'working' | 'done' | 'error'>('working');
  readonly error = signal<string | null>(null);

  async ngOnInit() {
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!this.auth.isAuthenticated()) {
      await this.router.navigate(['/login'], { queryParams: { returnUrl: `/verificar-correo/${token}` } });
      return;
    }
    try {
      await this.api.confirmEmailVerification(token);
      await this.auth.loadMe().catch(() => undefined);
      this.state.set('done');
    } catch (e) {
      this.error.set(errorMessage(e));
      this.state.set('error');
    }
  }
}
