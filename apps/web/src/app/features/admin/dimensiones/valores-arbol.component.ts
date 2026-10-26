import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/api.service';
import { DimensionesApi } from '../../../core/dimensiones.api';
import type { Dimension, DimensionValue, EstadoEstructura } from '../../../core/dimensiones.models';
import { ToastService } from '../../../core/toast.service';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { IconComponent } from '../../../shared/icon.component';
import { LoadingStateComponent } from '../../../shared/loading-state.component';
import {
  badgeClass,
  buildValorTree,
  descendientesConsigo,
  ESTADO_META,
  ESTADOS,
  validarVigencia,
} from './dimensiones.util';

interface Draft {
  id: string | null;
  codigo: string;
  nombre: string;
  padreId: string | null;
  estado: EstadoEstructura;
  vigenteDesde: string;
  vigenteHasta: string;
}

/**
 * Árbol de valores de una dimensión de tipo LISTA (ADR 0011 D8): crear/editar `DimensionValue` con padre para el
 * roll-up jerárquico. Carga sus propios valores a partir de la dimensión recibida. Las de sistema son solo lectura:
 * se muestran sin acciones de edición. Mutaciones: EDITOR+ (el servidor es el gate real).
 */
@Component({
  selector: 'nx-valores-arbol',
  imports: [FormsModule, IconComponent, EmptyStateComponent, ErrorStateComponent, LoadingStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card stack" style="margin-top:12px">
      <div class="card-title">
        <nx-icon name="list" [size]="16" />
        <h3 style="margin:0">Valores de {{ dimension().nombre }}</h3>
        <span class="muted small">{{ dimension().jerarquica ? 'Jerárquica (roll-up)' : 'Lista plana' }}</span>
        <span class="spacer"></span>
        @if (editable()) {
          <button class="btn sm" (click)="startCreate()"><nx-icon name="plus" [size]="14" />Nuevo valor</button>
        }
      </div>

      @if (loading()) {
        <nx-loading-state text="Cargando valores…" />
      } @else if (error()) {
        <nx-error-state title="No se pudieron cargar los valores" message="{{ error() }}" (retry)="load()" />
      } @else {
        @if (draft(); as d) {
          <div class="card stack editor">
            <div class="card-title">
              <nx-icon [name]="d.id ? 'pencil' : 'plus'" [size]="15" />
              <h3 style="margin:0">{{ d.id ? 'Editar valor' : 'Nuevo valor' }}</h3>
              <span class="spacer"></span>
              <button class="btn ghost icon sm" title="Cerrar" aria-label="Cerrar" (click)="draft.set(null)">
                <nx-icon name="x" [size]="15" />
              </button>
            </div>
            <div class="grid grid-2">
              <div class="field">
                <label for="dv-cod">Código</label>
                <input id="dv-cod" class="input mono" [(ngModel)]="d.codigo" [disabled]="!!d.id" placeholder="Ej. P-001" />
                @if (d.id) { <span class="hint">El código no se cambia tras crear el valor.</span> }
              </div>
              <div class="field">
                <label for="dv-nom">Nombre</label>
                <input id="dv-nom" class="input" [(ngModel)]="d.nombre" placeholder="Ej. Proyecto Apolo" />
              </div>
            </div>
            <div class="grid grid-3">
              @if (dimension().jerarquica) {
                <div class="field">
                  <label for="dv-padre">Valor padre</label>
                  <select id="dv-padre" class="input" [(ngModel)]="d.padreId">
                    <option [ngValue]="null">— Sin padre (raíz) —</option>
                    @for (v of posiblesPadres(); track v.id) { <option [ngValue]="v.id">{{ v.codigo }} · {{ v.nombre }}</option> }
                  </select>
                </div>
              }
              <div class="field">
                <label for="dv-est">Estado</label>
                <select id="dv-est" class="input" [(ngModel)]="d.estado">
                  @for (e of estados; track e) { <option [value]="e">{{ estadoMeta[e].label }}</option> }
                </select>
              </div>
              @if (!dimension().jerarquica) { <div></div> }
              <div></div>
            </div>
            <div class="grid grid-2">
              <div class="field"><label for="dv-desde">Vigente desde</label><input id="dv-desde" class="input" type="date" [(ngModel)]="d.vigenteDesde" /></div>
              <div class="field"><label for="dv-hasta">Vigente hasta</label><input id="dv-hasta" class="input" type="date" [(ngModel)]="d.vigenteHasta" /></div>
            </div>
            <div class="row">
              <span class="spacer"></span>
              <button class="btn" (click)="draft.set(null)">Cancelar</button>
              <button class="btn primary" [disabled]="busy() || invalid(d)" (click)="save()">
                <nx-icon name="save" [size]="15" />{{ d.id ? 'Guardar' : 'Crear' }}
              </button>
            </div>
          </div>
        }

        @if (!arbol().length) {
          <nx-empty-state
            icon="list"
            title="Sin valores"
            description="Esta dimensión aún no tiene valores. Cree el primero para poder etiquetar trabajo con ella."
            [actionLabel]="editable() ? 'Nuevo valor' : ''"
            actionIcon="plus"
            (action)="startCreate()" />
        } @else {
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Código</th><th>Nombre</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                @for (n of arbol(); track n.valor.id) {
                  <tr [class.selected]="draft()?.id === n.valor.id">
                    <td class="mono small nowrap" [style.padding-left.px]="12 + n.depth * 22">
                      @if (n.depth > 0) { <span class="tree-branch" aria-hidden="true">└</span> }{{ n.valor.codigo }}
                    </td>
                    <td><strong>{{ n.valor.nombre }}</strong></td>
                    <td><span [class]="badgeClass(estadoMeta[n.valor.estado].tono)">{{ estadoMeta[n.valor.estado].label }}</span></td>
                    <td class="num nowrap">
                      @if (editable()) {
                        <button class="btn ghost icon sm" title="Editar valor" aria-label="Editar valor" (click)="startEdit(n.valor)"><nx-icon name="pencil" [size]="14" /></button>
                        <button class="btn ghost icon sm danger" title="Eliminar valor" aria-label="Eliminar valor" (click)="remove(n.valor)"><nx-icon name="trash" [size]="14" /></button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </div>
  `,
  styles: `
    .tree-branch { color: var(--muted); margin-right: 6px; }
  `,
})
export class ValoresArbolComponent {
  private readonly api = inject(DimensionesApi);
  private readonly toast = inject(ToastService);

  readonly dimension = input.required<Dimension>();
  readonly canEdit = input<boolean>(false);

  readonly estados = ESTADOS;
  readonly estadoMeta = ESTADO_META;
  readonly badgeClass = badgeClass;

  readonly valores = signal<DimensionValue[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly draft = signal<Draft | null>(null);
  readonly busy = signal(false);

  /** Solo se edita si el usuario puede y la dimensión no es de sistema (las integradas son solo lectura). */
  readonly editable = computed(() => this.canEdit() && !this.dimension().esSistema);
  readonly arbol = computed(() => buildValorTree(this.valores()));

  /** Padres posibles: todos los valores menos el propio y sus descendientes (evita ciclos, ADR 0011 D8 c). */
  readonly posiblesPadres = computed(() => {
    const d = this.draft();
    const bloqueados = d?.id ? descendientesConsigo(this.valores(), d.id) : new Set<string>();
    return this.valores()
      .filter((v) => !bloqueados.has(v.id))
      .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es'));
  });

  constructor() {
    // Al cambiar la dimensión seleccionada, recarga sus valores y cierra cualquier borrador abierto.
    effect(() => {
      this.dimension();
      this.draft.set(null);
      void this.load();
    });
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.valores.set(await this.api.valores(this.dimension().id));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  startCreate() {
    this.draft.set({ id: null, codigo: '', nombre: '', padreId: null, estado: 'ACTIVA', vigenteDesde: '', vigenteHasta: '' });
  }

  startEdit(v: DimensionValue) {
    this.draft.set({
      id: v.id,
      codigo: v.codigo,
      nombre: v.nombre,
      padreId: v.padreId,
      estado: v.estado,
      vigenteDesde: v.vigenteDesde?.slice(0, 10) ?? '',
      vigenteHasta: v.vigenteHasta?.slice(0, 10) ?? '',
    });
  }

  invalid(d: Draft) {
    return d.codigo.trim().length < 1 || d.nombre.trim().length < 1;
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
      const dimId = this.dimension().id;
      const base = {
        nombre: d.nombre.trim(),
        padreId: this.dimension().jerarquica ? (d.padreId || null) : null,
        estado: d.estado,
        vigenteDesde: d.vigenteDesde || null,
        vigenteHasta: d.vigenteHasta || null,
      };
      if (d.id) await this.api.updateValor(dimId, d.id, base);
      else await this.api.createValor(dimId, { codigo: d.codigo.trim(), ...base });
      this.toast.success(d.id ? 'Valor actualizado' : 'Valor creado');
      this.draft.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async remove(v: DimensionValue) {
    if (!confirm(`¿Eliminar el valor "${v.nombre}"? Sus hijos quedarán sin padre.`)) return;
    try {
      await this.api.deleteValor(this.dimension().id, v.id);
      this.toast.success('Valor eliminado');
      if (this.draft()?.id === v.id) this.draft.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
