import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { InvitationPreview } from '../../core/models';
import { ROLE_LABELS } from '../../shared/budget';
import { IconComponent } from '../../shared/icon.component';
import { AUTH_BRAND_COMPACT, AUTH_HERO, AUTH_STYLES } from './auth.styles';

/**
 * Página pública de una invitación (`/invitacion/:token`, auditoría C1). Según la cuenta del correo invitado:
 * - no existe: la persona crea su cuenta con su nombre y contraseña;
 * - existe sin verificar: elige una contraseña nueva (el enlace demuestra que controla el correo) y se cierran las
 *   sesiones abiertas de esa cuenta;
 * - existe y está verificada: debe iniciar sesión con esa cuenta y aceptar.
 */
@Component({
  selector: 'nx-invitation',
  imports: [FormsModule, RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: AUTH_STYLES,
  template: `
    ${AUTH_HERO}
    <section class="form-side">
      <form (ngSubmit)="accept()">
        ${AUTH_BRAND_COMPACT}
        @if (loading()) {
          <p class="muted" role="status">Consultando la invitación…</p>
        } @else if (loadError()) {
          <div><h1>Invitación no disponible</h1></div>
          <div class="error-text" role="alert">{{ loadError() }}</div>
          <p class="muted small">Pida al administrador que le envíe una invitación nueva. <a routerLink="/login">Iniciar sesión</a></p>
        } @else if (invitation(); as inv) {
          <div>
            <h1>Únase a {{ inv.workspaceName }}</h1>
            <p class="muted">Le invitaron como <strong>{{ roleLabels[inv.role] }}</strong> con el correo {{ inv.email }}.</p>
          </div>
          @if (inv.requiresLogin) {
            @if (auth.isAuthenticated()) {
              <p class="muted small">Sesión iniciada como <strong>{{ auth.me()?.email ?? '…' }}</strong>. La invitación debe aceptarse con la cuenta del correo invitado.</p>
              @if (error()) { <div class="error-text" role="alert">{{ error() }}</div> }
              <button class="btn primary" type="submit" [disabled]="busy()">{{ busy() ? 'Aceptando…' : 'Aceptar invitación' }}</button>
              <button class="btn" type="button" (click)="switchAccount()">Iniciar sesión con otra cuenta</button>
            } @else {
              <p class="muted small">Ya tiene una cuenta en Nexo con ese correo. Inicie sesión con ella para aceptar la invitación.</p>
              <button class="btn primary" type="button" (click)="goLogin()">Iniciar sesión para aceptar</button>
            }
          } @else {
            @if (inv.accountExists) {
              <div class="callout info"><nx-icon name="info" [size]="16" />
                <span>Ya existe una cuenta con este correo, pero el correo no se había verificado. Al aceptar elegirá una contraseña nueva y se cerrarán todas las sesiones abiertas de esa cuenta.</span></div>
            }
            <div class="field"><label for="inv-name">Nombre</label>
              <input id="inv-name" class="input" name="name" [(ngModel)]="name" [required]="!inv.accountExists" minlength="2" maxlength="80" autocomplete="name" /></div>
            <div class="field"><label for="inv-password">{{ inv.accountExists ? 'Contraseña nueva' : 'Contraseña' }}</label>
              <input id="inv-password" class="input" type="password" name="password" [(ngModel)]="password" required minlength="8" maxlength="128"
                autocomplete="new-password" aria-describedby="inv-password-hint" />
              <span class="hint" id="inv-password-hint">Mínimo 8 caracteres; se recomiendan 12 o más</span></div>
            <div class="field"><label for="inv-confirm">Confirmar contraseña</label>
              <input id="inv-confirm" class="input" type="password" name="confirm" [(ngModel)]="confirm" required autocomplete="new-password" /></div>
            @if (confirm && password !== confirm) { <p class="error-text" role="alert">Las contraseñas no coinciden</p> }
            @if (error()) { <div class="error-text" role="alert">{{ error() }}</div> }
            <button class="btn primary" type="submit" [disabled]="busy() || !formValid()">{{ busy() ? 'Aceptando…' : 'Aceptar invitación' }}</button>
          }
          <p class="muted small">La invitación vence el {{ fmt(inv.expiresAt) }} y solo puede usarse una vez.</p>
        }
      </form>
    </section>
  `,
})
export class InvitationPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly roleLabels = ROLE_LABELS;
  private readonly token = this.route.snapshot.paramMap.get('token') ?? '';

  readonly invitation = signal<InvitationPreview | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  name = '';
  password = '';
  confirm = '';

  async ngOnInit() {
    try {
      const inv = await this.auth.invitation(this.token);
      this.invitation.set(inv);
      this.name = inv.name ?? '';
      if (inv.requiresLogin && this.auth.isAuthenticated() && !this.auth.me()) await this.auth.loadMe().catch(() => undefined);
    } catch (e) {
      this.loadError.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  formValid(): boolean {
    const inv = this.invitation();
    if (!inv || inv.requiresLogin) return true;
    if (!inv.accountExists && this.name.trim().length < 2) return false;
    return this.password.length >= 8 && this.password === this.confirm;
  }

  async accept() {
    const inv = this.invitation();
    if (!inv || !this.formValid()) {
      this.error.set('Revise los datos del formulario');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const body = inv.requiresLogin ? {} : { password: this.password, ...(this.name.trim() ? { name: this.name.trim() } : {}) };
      await this.auth.acceptInvitation(this.token, body);
      await this.router.navigate(['/']);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  goLogin() {
    void this.router.navigate(['/login'], { queryParams: { returnUrl: `/invitacion/${this.token}` } });
  }

  switchAccount() {
    void this.auth.logout(`/invitacion/${this.token}`);
  }

  fmt(iso: string) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es', { dateStyle: 'long', timeStyle: 'short' });
  }
}
