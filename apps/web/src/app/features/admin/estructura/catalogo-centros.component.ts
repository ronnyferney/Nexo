import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/api.service';
import { EstructuraApi } from '../../../core/estructura.api';
import type { CentroCosto, EstadoEstructura, LineaNegocio } from '../../../core/estructura.models';
import type { OrgUnit } from '../../../core/models';
import { ToastService } from '../../../core/toast.service';
import { treeOrder } from '../../../shared/budget';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { LoadingStateComponent } from '../../../shared/loading-state.component';
import { IconComponent } from '../../../shared/icon.component';
import { ESTADO_META, badgeClass, empresaNombre, validarVigencia } from './estructura.util';

interface Draft {
  id: string | null;
  empresaId: string;
  codigo: string;
  nombre: string;
  orgUnitId: string | null;
  lineaNegocioId: string | null;
  estado: EstadoEstructura;
  vigenteDesde: string;
  vigenteHasta: string;
}

/**
 * Catálogo de centros de costo por empresa (ADR 0011 D3/D5): dimensión económica, distinta del área. NO concede
 * permisos (RF42). Asociación por defecto opcional a una unidad y/o línea. Crear/editar: EDITOR+.
 */
@Component({
  selector: 'nx-catalogo-centros',
  imports: [FormsModule, IconComponent, EmptyStateComponent, ErrorStateComponent, LoadingStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalogo-centros.component.html',
})
export class CatalogoCentrosComponent implements OnInit {
  private readonly estructura = inject(EstructuraApi);
  private readonly toast = inject(ToastService);

  readonly empresas = input.required<OrgUnit[]>();
  readonly units = input.required<OrgUnit[]>();
  readonly canEdit = input<boolean>(false);

  readonly estados: EstadoEstructura[] = ['ACTIVA', 'SUSPENDIDA', 'CERRADA'];
  readonly estadoMeta = ESTADO_META;
  readonly badgeClass = badgeClass;

  readonly items = signal<CentroCosto[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly filtro = signal<string>('');
  readonly draft = signal<Draft | null>(null);
  readonly busy = signal(false);
  /** Líneas de la empresa del borrador, para la asociación opcional por defecto. */
  readonly lineasEmpresa = signal<LineaNegocio[]>([]);

  readonly unitTree = computed(() => treeOrder(this.units(), (u) => u.id, (u) => u.parentId));

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.items.set(await this.estructura.centros(this.filtro() || undefined));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  onFiltro(v: string) {
    this.filtro.set(v);
    void this.load();
  }

  empresaDe(id: string) {
    return empresaNombre(this.empresas(), id);
  }

  unitName(id: string | null) {
    return (id && this.units().find((u) => u.id === id)?.name) || '—';
  }

  pad(depth: number) {
    return '   '.repeat(depth);
  }

  private async loadLineas(empresaId: string) {
    try {
      this.lineasEmpresa.set(empresaId ? await this.estructura.lineas(empresaId) : []);
    } catch {
      this.lineasEmpresa.set([]);
    }
  }

  async startCreate() {
    const empresaId = this.filtro() || this.empresas()[0]?.id || '';
    this.draft.set({
      id: null,
      empresaId,
      codigo: '',
      nombre: '',
      orgUnitId: null,
      lineaNegocioId: null,
      estado: 'ACTIVA',
      vigenteDesde: '',
      vigenteHasta: '',
    });
    await this.loadLineas(empresaId);
  }

  async startEdit(c: CentroCosto) {
    this.draft.set({
      id: c.id,
      empresaId: c.empresaId,
      codigo: c.codigo,
      nombre: c.nombre,
      orgUnitId: c.orgUnitId,
      lineaNegocioId: c.lineaNegocioId,
      estado: c.estado,
      vigenteDesde: c.vigenteDesde?.slice(0, 10) ?? '',
      vigenteHasta: c.vigenteHasta?.slice(0, 10) ?? '',
    });
    await this.loadLineas(c.empresaId);
  }

  async onEmpresaChange(empresaId: string) {
    const d = this.draft();
    if (d) this.draft.set({ ...d, empresaId, lineaNegocioId: null });
    await this.loadLineas(empresaId);
  }

  invalid(d: Draft) {
    return !d.empresaId || d.codigo.trim().length < 1 || d.nombre.trim().length < 2;
  }

  async save() {
    const d = this.draft();
    if (!d || this.invalid(d)) return;
    const err = validarVigencia(d.vigenteDesde || null, d.vigenteHasta || null);
    if (err) {
      this.toast.error(err);
      return;
    }
    this.busy.set(true);
    try {
      const body = {
        codigo: d.codigo.trim(),
        nombre: d.nombre.trim(),
        orgUnitId: d.orgUnitId || null,
        lineaNegocioId: d.lineaNegocioId || null,
        estado: d.estado,
        vigenteDesde: d.vigenteDesde || null,
        vigenteHasta: d.vigenteHasta || null,
      };
      if (d.id) await this.estructura.updateCentro(d.id, body);
      else await this.estructura.createCentro({ empresaId: d.empresaId, ...body });
      this.toast.success(d.id ? 'Centro de costo actualizado' : 'Centro de costo creado');
      this.draft.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async remove(c: CentroCosto) {
    if (!confirm(`¿Eliminar el centro de costo "${c.nombre}"?`)) return;
    try {
      await this.estructura.deleteCentro(c.id);
      this.toast.success('Centro de costo eliminado');
      if (this.draft()?.id === c.id) this.draft.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
