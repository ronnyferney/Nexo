import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../../core/api.service';
import type { OrgMember, OrgUnit } from '../../../core/models';
import { ToastService } from '../../../core/toast.service';
import { treeOrder } from '../../../shared/budget';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { IconComponent } from '../../../shared/icon.component';
import { ESTADO_META, TIPO_META, badgeClass, empresaNombre, empresasDe, validarVigencia } from './estructura.util';
import { ORG_UNIT_TIPOS, type EstadoEstructura, type OrgUnitTipo } from '../../../core/estructura.models';

interface UnitDraft {
  id: string;
  name: string;
  tipo: OrgUnitTipo;
  empresaId: string | null;
  responsableUserId: string | null;
  estado: EstadoEstructura;
  vigenteDesde: string;
  vigenteHasta: string;
  isRoot: boolean;
}

interface NewDraft {
  parentId: string;
  name: string;
  code: string;
  tipo: OrgUnitTipo;
  empresaId: string | null;
}

/**
 * Vista de la dimensión jerárquica/funcional (ADR 0011 D2): árbol de unidades ordenado por jerarquía, mostrando tipo,
 * estado, empresa y responsable. Permite editar los campos empresariales de una unidad y crear subunidades tipadas
 * (EDITOR+). El renombrado básico, el movimiento y los modelos permitidos siguen en la página «Organización».
 */
@Component({
  selector: 'nx-estructura-arbol',
  imports: [FormsModule, IconComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './estructura-arbol.component.html',
})
export class EstructuraArbolComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly units = input.required<OrgUnit[]>();
  readonly members = input.required<OrgMember[]>();
  readonly canEdit = input<boolean>(false);
  readonly changed = output<void>();

  readonly tipos = ORG_UNIT_TIPOS;
  readonly estados: EstadoEstructura[] = ['ACTIVA', 'SUSPENDIDA', 'CERRADA'];
  readonly tipoMeta = TIPO_META;
  readonly estadoMeta = ESTADO_META;
  readonly badgeClass = badgeClass;

  readonly tree = computed(() => treeOrder(this.units(), (u) => u.id, (u) => u.parentId));
  readonly empresas = computed(() => empresasDe(this.units()));
  readonly memberName = computed(() => new Map(this.members().map((m) => [m.userId, m.name])));

  readonly editing = signal<UnitDraft | null>(null);
  readonly creating = signal<NewDraft | null>(null);
  readonly busy = signal(false);

  empresaDe(id: string | null) {
    return empresaNombre(this.units(), id);
  }

  responsable(userId: string | null) {
    return (userId && this.memberName().get(userId)) || '—';
  }

  pad(depth: number) {
    return '   '.repeat(depth);
  }

  startCreate(parentId: string) {
    this.editing.set(null);
    const parent = this.units().find((u) => u.id === parentId);
    this.creating.set({ parentId, name: '', code: '', tipo: 'AREA_FUNCIONAL', empresaId: parent?.empresaId ?? null });
  }

  async create() {
    const d = this.creating();
    if (!d || d.name.trim().length < 2) return;
    this.busy.set(true);
    try {
      await this.api.createOrgUnit({
        name: d.name.trim(),
        parentId: d.parentId,
        tipo: d.tipo,
        ...(d.code.trim() ? { code: d.code.trim() } : {}),
        ...(d.empresaId ? { empresaId: d.empresaId } : {}),
      });
      this.toast.success('Unidad creada');
      this.creating.set(null);
      this.changed.emit();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  startEdit(u: OrgUnit) {
    this.creating.set(null);
    this.editing.set({
      id: u.id,
      name: u.name,
      tipo: u.tipo,
      empresaId: u.empresaId,
      responsableUserId: u.responsableUserId,
      estado: u.estado,
      vigenteDesde: u.vigenteDesde?.slice(0, 10) ?? '',
      vigenteHasta: u.vigenteHasta?.slice(0, 10) ?? '',
      isRoot: u.isRoot,
    });
  }

  async save() {
    const d = this.editing();
    if (!d || d.name.trim().length < 2) return;
    const err = validarVigencia(d.vigenteDesde || null, d.vigenteHasta || null);
    if (err) {
      this.toast.error(err);
      return;
    }
    this.busy.set(true);
    try {
      await this.api.updateOrgUnit(d.id, {
        name: d.name.trim(),
        tipo: d.tipo,
        empresaId: d.empresaId || null,
        responsableUserId: d.responsableUserId || null,
        estado: d.estado,
        vigenteDesde: d.vigenteDesde || null,
        vigenteHasta: d.vigenteHasta || null,
      });
      this.toast.success('Unidad actualizada');
      this.editing.set(null);
      this.changed.emit();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
