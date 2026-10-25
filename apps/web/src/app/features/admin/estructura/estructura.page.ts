import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { ApiService, errorMessage } from '../../../core/api.service';
import { AuthService } from '../../../core/auth.service';
import type { Agent, OrgMember, OrgUnit } from '../../../core/models';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { IconComponent } from '../../../shared/icon.component';
import { LoadingStateComponent } from '../../../shared/loading-state.component';
import { PageHeaderComponent } from '../../../layout/page-header.component';
import { empresasDe } from './estructura.util';
import { EstructuraArbolComponent } from './estructura-arbol.component';
import { CatalogoLineasComponent } from './catalogo-lineas.component';
import { CatalogoSedesComponent } from './catalogo-sedes.component';
import { CatalogoCentrosComponent } from './catalogo-centros.component';
import { AsignacionesComponent } from './asignaciones.component';

type Tab = 'arbol' | 'lineas' | 'sedes' | 'centros' | 'asignaciones';

/**
 * Estructura empresarial (ADR 0011 E1): árbol tipado de unidades (grupo→empresa→área…), catálogos de líneas de negocio,
 * sedes y centros de costo por empresa, y la matriz de asignaciones. Carga una sola vez los datos de referencia
 * (unidades, empresas, agentes, miembros) y los comparte con las pestañas. Lectura para todos; editar requiere EDITOR+.
 */
@Component({
  selector: 'nx-admin-estructura',
  imports: [
    IconComponent,
    ErrorStateComponent,
    LoadingStateComponent,
    PageHeaderComponent,
    EstructuraArbolComponent,
    CatalogoLineasComponent,
    CatalogoSedesComponent,
    CatalogoCentrosComponent,
    AsignacionesComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nx-page-header
        heading="Estructura"
        description="Organización empresarial: unidades por tipo, líneas de negocio, sedes, centros de costo y asignaciones"
        [crumbs]="[{ label: 'Administración', link: '/admin' }, { label: 'Estructura' }]">
        <button actions class="btn" (click)="load()" [disabled]="loading()">
          <nx-icon name="refresh" [size]="15" />Actualizar
        </button>
      </nx-page-header>

      @if (loading()) {
        <nx-loading-state text="Cargando la estructura…" />
      } @else if (error()) {
        <nx-error-state title="No se pudo cargar la estructura" message="{{ error() }}" (retry)="load()" />
      } @else {
        <div class="tabs" role="tablist" aria-label="Secciones de la estructura">
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
          @case ('arbol') {
            <nx-estructura-arbol [units]="units()" [members]="members()" [canEdit]="canEdit()" (changed)="load()" />
          }
          @case ('lineas') {
            <nx-catalogo-lineas [empresas]="empresas()" [members]="members()" [canEdit]="canEdit()" />
          }
          @case ('sedes') {
            <nx-catalogo-sedes [empresas]="empresas()" [canEdit]="canEdit()" />
          }
          @case ('centros') {
            <nx-catalogo-centros [empresas]="empresas()" [units]="units()" [canEdit]="canEdit()" />
          }
          @case ('asignaciones') {
            <nx-asignaciones
              [units]="units()"
              [empresas]="empresas()"
              [agents]="agents()"
              [members]="members()"
              [canEdit]="canEdit()" />
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
export class EstructuraPage implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);

  readonly tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'arbol', label: 'Estructura', icon: 'building' },
    { id: 'lineas', label: 'Líneas de negocio', icon: 'target' },
    { id: 'sedes', label: 'Sedes', icon: 'globe' },
    { id: 'centros', label: 'Centros de costo', icon: 'wallet' },
    { id: 'asignaciones', label: 'Asignaciones', icon: 'shuffle' },
  ];

  readonly tab = signal<Tab>('arbol');
  readonly units = signal<OrgUnit[]>([]);
  readonly agents = signal<Agent[]>([]);
  readonly members = signal<OrgMember[]>([]);
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
      const [units, agents, members] = await Promise.all([
        this.api.adminOrgUnits(),
        this.api.agents().catch(() => [] as Agent[]),
        this.api.orgMembers().catch(() => [] as OrgMember[]),
      ]);
      this.units.set(units);
      this.agents.set(agents);
      this.members.set(members);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
