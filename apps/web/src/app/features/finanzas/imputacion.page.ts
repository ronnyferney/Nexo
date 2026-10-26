import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { OrgUnit } from '../../core/models';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { PageHeaderComponent } from '../../layout/page-header.component';
import { empresasDe } from '../admin/estructura/estructura.util';
import { ServiciosInternosComponent } from './servicios-internos.component';
import { ConsolaConsolidacionComponent } from './consola-consolidacion.component';

type Tab = 'servicios' | 'consolidacion';

/**
 * Imputación de costos (ADR 0011 D5/D7 · E9). Dos secciones: los servicios internos / compartidos con su editor de
 * reparto (RF44/RF45) y la consola de consolidación económica que separa el costo medido del estimado (RF47 parcial).
 * Carga una vez las unidades (para derivar las empresas y las áreas de los selectores) y las comparte con las pestañas.
 * Lectura para todos; editar el reparto y los servicios requiere EDITOR+ (el servidor es el gate real).
 */
@Component({
  selector: 'nx-imputacion',
  imports: [
    IconComponent,
    ErrorStateComponent,
    LoadingStateComponent,
    PageHeaderComponent,
    ServiciosInternosComponent,
    ConsolaConsolidacionComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nx-page-header
        heading="Imputación de costos"
        description="Servicios internos / compartidos y su reparto de costo, y consolidación económica por empresa, línea, área o centro de costo"
        [crumbs]="[{ label: 'Administración', link: '/admin' }, { label: 'Imputación de costos' }]">
        <button actions class="btn" (click)="load()" [disabled]="loading()">
          <nx-icon name="refresh" [size]="15" />Actualizar
        </button>
      </nx-page-header>

      @if (loading()) {
        <nx-loading-state text="Cargando la imputación de costos…" />
      } @else if (error()) {
        <nx-error-state title="No se pudo cargar la imputación de costos" message="{{ error() }}" (retry)="load()" />
      } @else {
        <div class="tabs" role="tablist" aria-label="Secciones de la imputación de costos">
          @for (t of tabs; track t.id) {
            <button
              class="tab"
              role="tab"
              [class.active]="tab() === t.id"
              [attr.aria-selected]="tab() === t.id"
              (click)="tab.set(t.id)">
              <nx-icon [name]="t.icon" [size]="15" />{{ t.label }}
            </button>
          }
        </div>

        @switch (tab()) {
          @case ('servicios') {
            <nx-servicios-internos [empresas]="empresas()" [units]="units()" [canEdit]="canEdit()" />
          }
          @case ('consolidacion') {
            <nx-consola-consolidacion [empresas]="empresas()" [units]="units()" />
          }
        }
      }
    </div>
  `,
  styles: `
    .tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 18px; border-bottom: 1px solid var(--border); }
    .tab { display: inline-flex; align-items: center; gap: 7px; padding: 9px 14px; background: none; border: 0; border-bottom: 2px solid transparent; color: var(--muted); font-weight: 600; font-size: 13.5px; cursor: pointer; border-radius: 6px 6px 0 0; }
    .tab:hover { color: var(--text); background: var(--surface-2); }
    .tab.active { color: var(--primary); border-bottom-color: var(--primary); }
    .tab:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
  `,
})
export class ImputacionPage implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);

  readonly tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'servicios', label: 'Servicios internos', icon: 'scale' },
    { id: 'consolidacion', label: 'Consolidación económica', icon: 'chart' },
  ];

  readonly tab = signal<Tab>('servicios');
  readonly units = signal<OrgUnit[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly empresas = computed(() => empresasDe(this.units()));
  readonly canEdit = computed(() => this.auth.canEdit());

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.units.set(await this.api.adminOrgUnits());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
