import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { ApiService, errorMessage } from '../../../core/api.service';
import type { PilotConfig } from '../../../core/models';
import { ToastService } from '../../../core/toast.service';
import { IconComponent } from '../../../shared/icon.component';
import { RelativeTimePipe } from '../../../shared/relative-time.pipe';

/**
 * Preset de piloto US$ 0 (P0.1b). Con el modo piloto activo, la plataforma solo permite el proveedor simulado
 * (mock): cualquier proveedor real se rechaza para que el costo externo sea 0. Lo opera un ADMIN/OWNER humano.
 */
@Component({
  selector: 'nx-pilot-toggle',
  imports: [IconComponent, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card stack" style="margin-top:16px">
      <div class="card-title">
        <div class="icon-tile"><nx-icon name="beaker" /></div>
        <div>
          <h2>Modo piloto US$ 0</h2>
          <p class="muted small" style="margin:0">Solo se permite el proveedor simulado; el gasto externo es 0</p>
        </div>
      </div>

      @if (loading()) {
        <p class="muted small">Cargando…</p>
      } @else if (error()) {
        <div class="callout warning" role="alert"><nx-icon name="alert" [size]="16" /><span>{{ error() }}</span>
          <button class="btn sm" (click)="load()">Reintentar</button></div>
      } @else if (pilot(); as p) {
        <div class="row" style="gap:12px; align-items:center">
          <span class="badge" [class.info]="p.modoPiloto" [class.danger]="!p.modoPiloto">
            {{ p.modoPiloto ? 'Activo' : 'Inactivo' }}</span>
          @if (p.modoPiloto && p.desde) { <span class="muted small">desde {{ p.desde | ago }}</span> }
          <span class="spacer"></span>
          @if (canEdit()) {
            <button class="btn" [class.primary]="!p.modoPiloto" [class.danger]="p.modoPiloto"
              [disabled]="saving()" (click)="toggle()">
              <nx-icon [name]="p.modoPiloto ? 'stop' : 'play'" [size]="15" />
              {{ saving() ? 'Guardando…' : (p.modoPiloto ? 'Desactivar' : 'Activar') }}
            </button>
          }
        </div>
        <div class="callout info"><nx-icon name="info" [size]="16" /><span>Con el modo piloto activo, las ejecuciones
          con cualquier proveedor real se rechazan: solo funciona el proveedor <strong>simulado (mock)</strong>. Úselo
          para pruebas sin costo. Solo lo cambia un administrador humano.</span></div>
      }
    </div>
  `,
})
export class PilotToggleComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly canEdit = input(false);

  readonly pilot = signal<PilotConfig | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.pilot.set(await this.api.pilot());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async toggle() {
    const p = this.pilot();
    if (!p) return;
    const next = !p.modoPiloto;
    if (
      !confirm(
        next
          ? '¿Activar el modo piloto US$ 0? Solo funcionará el proveedor simulado; se rechazarán los proveedores reales.'
          : '¿Desactivar el modo piloto? Volverán a permitirse los proveedores reales (con costo).',
      )
    )
      return;
    this.saving.set(true);
    try {
      this.pilot.set(await this.api.setPilot(next));
      this.toast.success(next ? 'Modo piloto activado' : 'Modo piloto desactivado');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
