import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { ApiService, errorMessage } from '../../../core/api.service';
import { DimensionesApi } from '../../../core/dimensiones.api';
import type { Dimension } from '../../../core/dimensiones.models';
import type { OrgUnit } from '../../../core/models';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { IconComponent } from '../../../shared/icon.component';
import { LoadingStateComponent } from '../../../shared/loading-state.component';
import { PageHeaderComponent } from '../../../layout/page-header.component';
import { empresasDe } from '../estructura/estructura.util';
import { CatalogoDimensionesComponent } from './catalogo-dimensiones.component';
import { ConsolaAnalisisComponent } from './consola-analisis.component';

type Tab = 'dimensiones' | 'consola';

/**
 * Marco de dimensiones configurables y consola de análisis (ADR 0011 D8 · E1b). Dos secciones: el administrador de
 * dimensiones (catálogo + árbol de valores) y la consola de análisis (pivot del consumo por cualquier dimensión).
 * Carga una vez las empresas (para los selectores) y el catálogo de dimensiones (para el selector de la consola).
 * Lectura para todos; editar requiere EDITOR+ (las dimensiones de sistema son solo lectura).
 */
@Component({
  selector: 'nx-admin-dimensiones',
  imports: [
    IconComponent,
    ErrorStateComponent,
    LoadingStateComponent,
    PageHeaderComponent,
    CatalogoDimensionesComponent,
    ConsolaAnalisisComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nx-page-header
        heading="Dimensiones"
        description="Marco de dimensiones configurables para clasificar y analizar el trabajo, y consola de análisis del consumo"
        [crumbs]="[{ label: 'Administración', link: '/admin' }, { label: 'Dimensiones' }]">
        <button actions class="btn" (click)="load()" [disabled]="loading()">
          <nx-icon name="refresh" [size]="15" />Actualizar
        </button>
      </nx-page-header>

      @if (loading()) {
        <nx-loading-state text="Cargando dimensiones…" />
      } @else if (error()) {
        <nx-error-state title="No se pudieron cargar las dimensiones" message="{{ error() }}" (retry)="load()" />
      } @else {
        <div class="tabs" role="tablist" aria-label="Secciones de dimensiones">
          @for (t of tabs; track t.id) {
            <button class="tab" role="tab" [class.active]="tab() === t.id" [attr.aria-selected]="tab() === t.id" (click)="tab.set(t.id)">
              <nx-icon [name]="t.icon" [size]="15" />{{ t.label }}
            </button>
          }
        </div>

        @switch (tab()) {
          @case ('dimensiones') {
            <nx-catalogo-dimensiones [empresas]="empresas()" />
          }
          @case ('consola') {
            <nx-consola-analisis [dimensiones]="dimensiones()" />
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
export class DimensionesPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly dims = inject(DimensionesApi);

  readonly tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'dimensiones', label: 'Dimensiones', icon: 'layers' },
    { id: 'consola', label: 'Consola de análisis', icon: 'chart' },
  ];

  readonly tab = signal<Tab>('dimensiones');
  readonly units = signal<OrgUnit[]>([]);
  readonly dimensiones = signal<Dimension[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly empresas = computed(() => empresasDe(this.units()));

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [units, dimensiones] = await Promise.all([
        this.api.adminOrgUnits().catch(() => [] as OrgUnit[]),
        this.dims.dimensiones(),
      ]);
      this.units.set(units);
      this.dimensiones.set(dimensiones);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
