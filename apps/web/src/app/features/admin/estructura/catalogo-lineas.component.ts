import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/api.service';
import { EstructuraApi } from '../../../core/estructura.api';
import type { LineaNegocio } from '../../../core/estructura.models';
import type { OrgMember, OrgUnit } from '../../../core/models';
import { ToastService } from '../../../core/toast.service';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { LoadingStateComponent } from '../../../shared/loading-state.component';
import { IconComponent } from '../../../shared/icon.component';
import { ESTADO_META, badgeClass, empresaNombre, validarVigencia } from './estructura.util';
import type { EstadoEstructura } from '../../../core/estructura.models';

interface Draft {
  id: string | null;
  empresaId: string;
  codigo: string;
  nombre: string;
  responsableUserId: string | null;
  estado: EstadoEstructura;
  vigenteDesde: string;
  vigenteHasta: string;
}

/** Catálogo de líneas de negocio por empresa (ADR 0011 D3): oferta económica que cruza áreas. Crear/editar: EDITOR+. */
@Component({
  selector: 'nx-catalogo-lineas',
  imports: [FormsModule, IconComponent, EmptyStateComponent, ErrorStateComponent, LoadingStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalogo-lineas.component.html',
})
export class CatalogoLineasComponent implements OnInit {
  private readonly estructura = inject(EstructuraApi);
  private readonly toast = inject(ToastService);

  readonly empresas = input.required<OrgUnit[]>();
  readonly members = input.required<OrgMember[]>();
  readonly canEdit = input<boolean>(false);

  readonly estados: EstadoEstructura[] = ['ACTIVA', 'SUSPENDIDA', 'CERRADA'];
  readonly estadoMeta = ESTADO_META;
  readonly badgeClass = badgeClass;

  readonly items = signal<LineaNegocio[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly filtro = signal<string>('');
  readonly draft = signal<Draft | null>(null);
  readonly busy = signal(false);

  readonly memberName = computed(() => new Map(this.members().map((m) => [m.userId, m.name])));

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.items.set(await this.estructura.lineas(this.filtro() || undefined));
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

  responsable(userId: string | null) {
    return (userId && this.memberName().get(userId)) || '—';
  }

  startCreate() {
    this.draft.set({
      id: null,
      empresaId: this.filtro() || this.empresas()[0]?.id || '',
      codigo: '',
      nombre: '',
      responsableUserId: null,
      estado: 'ACTIVA',
      vigenteDesde: '',
      vigenteHasta: '',
    });
  }

  startEdit(l: LineaNegocio) {
    this.draft.set({
      id: l.id,
      empresaId: l.empresaId,
      codigo: l.codigo,
      nombre: l.nombre,
      responsableUserId: l.responsableUserId,
      estado: l.estado,
      vigenteDesde: l.vigenteDesde?.slice(0, 10) ?? '',
      vigenteHasta: l.vigenteHasta?.slice(0, 10) ?? '',
    });
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
        responsableUserId: d.responsableUserId || null,
        estado: d.estado,
        vigenteDesde: d.vigenteDesde || null,
        vigenteHasta: d.vigenteHasta || null,
      };
      if (d.id) await this.estructura.updateLinea(d.id, body);
      else await this.estructura.createLinea({ empresaId: d.empresaId, ...body });
      this.toast.success(d.id ? 'Línea actualizada' : 'Línea creada');
      this.draft.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async remove(l: LineaNegocio) {
    if (!confirm(`¿Eliminar la línea de negocio "${l.nombre}"?`)) return;
    try {
      await this.estructura.deleteLinea(l.id);
      this.toast.success('Línea eliminada');
      if (this.draft()?.id === l.id) this.draft.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
