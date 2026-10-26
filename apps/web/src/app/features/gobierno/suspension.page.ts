import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.service';
import { GovernanceApi } from '../../core/governance.api';
import { SUSPENSION_SCOPES, type Suspension, type SuspensionScope } from '../../core/governance.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { SCOPE_META } from './governance.util';

/** Suspensión de emergencia (E6 · RF13, ADMIN). Interruptor por alcance + reactivación con motivo. */
@Component({
  selector: 'nx-suspension',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, RelativeTimePipe],
  templateUrl: './suspension.page.html',
})
export class SuspensionPage implements OnInit {
  private readonly api = inject(GovernanceApi);
  private readonly toast = inject(ToastService);

  readonly scopes = SUSPENSION_SCOPES;
  readonly scopeMeta = SCOPE_META;

  readonly items = signal<Suspension[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly soloActivas = signal(false);
  readonly saving = signal(false);

  // Borrador de nueva suspensión.
  readonly creating = signal(false);
  readonly alcance = signal<SuspensionScope>('AGENTE');
  readonly targetId = signal('');
  readonly motivo = signal('');

  // Reactivación en curso.
  readonly reactivando = signal<Suspension | null>(null);
  readonly reactivarMotivo = signal('');

  readonly activas = computed(() => this.items().filter((s) => s.activa).length);

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.items.set(await this.api.suspensions(this.soloActivas()));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  abrirNueva() {
    this.alcance.set('AGENTE');
    this.targetId.set('');
    this.motivo.set('');
    this.creating.set(true);
  }

  invalidNueva = computed(() => this.targetId().trim().length < 1 || this.motivo().trim().length < 3);

  async crear() {
    if (this.invalidNueva()) return;
    this.saving.set(true);
    try {
      await this.api.createSuspension({
        alcance: this.alcance(),
        targetId: this.targetId().trim(),
        motivo: this.motivo().trim(),
      });
      this.toast.success('Suspensión activada');
      this.creating.set(false);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  abrirReactivar(s: Suspension) {
    this.reactivarMotivo.set('');
    this.reactivando.set(s);
  }

  async reactivar() {
    const s = this.reactivando();
    if (!s) return;
    const motivo = this.reactivarMotivo().trim();
    if (motivo.length < 3) {
      this.toast.error('Indique el motivo de la reactivación (mínimo 3 caracteres).');
      return;
    }
    this.saving.set(true);
    try {
      await this.api.reactivateSuspension(s.id, motivo);
      this.toast.success('Alcance reactivado');
      this.reactivando.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
