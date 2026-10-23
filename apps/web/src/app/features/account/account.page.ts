import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

/** Mi cuenta: datos del usuario y cambio de contraseña (obligatorio para el usuario maestro al primer ingreso). */
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
            <div><h2>{{ me.name }}</h2><p class="muted small">{{ me.email }}</p></div></div>
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
    </div>
  `,
})
export class AccountPage {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  readonly saving = signal(false);
  current = '';
  next = '';
  confirm = '';

  async save() {
    if (this.next !== this.confirm) return;
    this.saving.set(true);
    try {
      await this.api.changePassword({ currentPassword: this.current, newPassword: this.next });
      this.current = this.next = this.confirm = '';
      this.toast.success('Contraseña actualizada');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
