import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/api.service';
import { EstructuraApi } from '../../../core/estructura.api';
import type { EstadoEstructura, Sede } from '../../../core/estructura.models';
import type { OrgUnit } from '../../../core/models';
import { ToastService } from '../../../core/toast.service';
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
  zonaHoraria: string;
  alcanceTerritorial: string;
  estado: EstadoEstructura;
  vigenteDesde: string;
  vigenteHasta: string;
}

/** Catálogo de sedes por empresa (ADR 0011 D3): dimensión territorial con zona horaria. Crear/editar: EDITOR+. */
@Component({
  selector: 'nx-catalogo-sedes',
  imports: [FormsModule, IconComponent, EmptyStateComponent, ErrorStateComponent, LoadingStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalogo-sedes.component.html',
})
export class CatalogoSedesComponent implements OnInit {
  private readonly estructura = inject(EstructuraApi);
  private readonly toast = inject(ToastService);

  readonly empresas = input.required<OrgUnit[]>();
  readonly canEdit = input<boolean>(false);

  readonly estados: EstadoEstructura[] = ['ACTIVA', 'SUSPENDIDA', 'CERRADA'];
  readonly estadoMeta = ESTADO_META;
  readonly badgeClass = badgeClass;

  readonly items = signal<Sede[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly filtro = signal<string>('');
  readonly draft = signal<Draft | null>(null);
  readonly busy = signal(false);

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.items.set(await this.estructura.sedes(this.filtro() || undefined));
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

  startCreate() {
    this.draft.set({
      id: null,
      empresaId: this.filtro() || this.empresas()[0]?.id || '',
      codigo: '',
      nombre: '',
      zonaHoraria: 'America/Bogota',
      alcanceTerritorial: '',
      estado: 'ACTIVA',
      vigenteDesde: '',
      vigenteHasta: '',
    });
  }

  startEdit(s: Sede) {
    this.draft.set({
      id: s.id,
      empresaId: s.empresaId,
      codigo: s.codigo,
      nombre: s.nombre,
      zonaHoraria: s.zonaHoraria,
      alcanceTerritorial: s.alcanceTerritorial ?? '',
      estado: s.estado,
      vigenteDesde: s.vigenteDesde?.slice(0, 10) ?? '',
      vigenteHasta: s.vigenteHasta?.slice(0, 10) ?? '',
    });
  }

  invalid(d: Draft) {
    return !d.empresaId || d.codigo.trim().length < 1 || d.nombre.trim().length < 2 || d.zonaHoraria.trim().length < 1;
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
        zonaHoraria: d.zonaHoraria.trim(),
        alcanceTerritorial: d.alcanceTerritorial.trim() || null,
        estado: d.estado,
        vigenteDesde: d.vigenteDesde || null,
        vigenteHasta: d.vigenteHasta || null,
      };
      if (d.id) await this.estructura.updateSede(d.id, body);
      else await this.estructura.createSede({ empresaId: d.empresaId, ...body });
      this.toast.success(d.id ? 'Sede actualizada' : 'Sede creada');
      this.draft.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async remove(s: Sede) {
    if (!confirm(`¿Eliminar la sede "${s.nombre}"?`)) return;
    try {
      await this.estructura.deleteSede(s.id);
      this.toast.success('Sede eliminada');
      if (this.draft()?.id === s.id) this.draft.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
