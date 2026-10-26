import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/api.service';
import { AuthService } from '../../../core/auth.service';
import { DimensionesApi } from '../../../core/dimensiones.api';
import type { Dimension, DimensionTipoValor, EstadoEstructura } from '../../../core/dimensiones.models';
import { DIMENSION_TIPOS_VALOR } from '../../../core/dimensiones.models';
import type { OrgUnit } from '../../../core/models';
import { ToastService } from '../../../core/toast.service';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { IconComponent } from '../../../shared/icon.component';
import { LoadingStateComponent } from '../../../shared/loading-state.component';
import { empresaNombre } from '../estructura/estructura.util';
import {
  APLICA_A_OPCIONES,
  badgeClass,
  ESTADO_META,
  ESTADOS,
  REFERENCIA_META,
  referenciaLabel,
  tipoValorLabel,
  TIPO_VALOR_META,
  validarVigencia,
} from './dimensiones.util';
import { ValoresArbolComponent } from './valores-arbol.component';

interface Draft {
  id: string | null;
  codigo: string;
  nombre: string;
  empresaId: string;
  tipoValor: DimensionTipoValor;
  referenciaEntidad: string;
  jerarquica: boolean;
  obligatoria: boolean;
  obligatoriaParaEfectoEconomico: boolean;
  aplicaA: string[];
  estado: EstadoEstructura;
  vigenteDesde: string;
  vigenteHasta: string;
}

/**
 * Administrador de dimensiones configurables (ADR 0011 D8 · E1b): lista las dimensiones distinguiendo las de sistema
 * (línea de negocio, sede, centro de costo; solo lectura) de las del cliente; permite crear/editar las del cliente y,
 * para las de tipo LISTA, abrir su árbol de valores. Mutaciones: EDITOR+.
 */
@Component({
  selector: 'nx-catalogo-dimensiones',
  imports: [
    FormsModule,
    IconComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    LoadingStateComponent,
    ValoresArbolComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row wrap" style="margin-bottom:16px">
      <div class="field" style="min-width:220px">
        <label for="dim-emp">Empresa</label>
        <select id="dim-emp" class="input" [ngModel]="filtro()" (ngModelChange)="onFiltro($event)">
          <option value="">Todas (incluye las de organización)</option>
          @for (e of empresas(); track e.id) { <option [value]="e.id">{{ e.name }}</option> }
        </select>
      </div>
      <span class="spacer"></span>
      @if (canEdit()) {
        <button class="btn primary brand" style="align-self:end" (click)="startCreate()"><nx-icon name="plus" />Nueva dimensión</button>
      }
    </div>

    @if (loading()) {
      <nx-loading-state text="Cargando dimensiones…" />
    } @else if (error()) {
      <nx-error-state title="No se pudieron cargar las dimensiones" message="{{ error() }}" (retry)="load()" />
    } @else {
      @if (draft(); as d) {
        <div class="card stack editor" style="margin-bottom:16px">
          <div class="card-title">
            <nx-icon [name]="d.id ? 'pencil' : 'plus'" />
            <h2>{{ d.id ? 'Editar dimensión' : 'Nueva dimensión' }}</h2>
            <span class="spacer"></span>
            <button class="btn ghost icon" title="Cerrar" aria-label="Cerrar" (click)="draft.set(null)"><nx-icon name="x" /></button>
          </div>
          <div class="grid grid-3">
            <div class="field">
              <label for="dd-cod">Código</label>
              <input id="dd-cod" class="input mono" [(ngModel)]="d.codigo" [disabled]="!!d.id" placeholder="Ej. proyecto" />
              @if (d.id) { <span class="hint">El código no se cambia tras crear la dimensión.</span> }
            </div>
            <div class="field">
              <label for="dd-nom">Nombre</label>
              <input id="dd-nom" class="input" [(ngModel)]="d.nombre" placeholder="Ej. Proyecto" />
            </div>
            <div class="field">
              <label for="dd-emp">Empresa</label>
              <select id="dd-emp" class="input" [(ngModel)]="d.empresaId" [disabled]="!!d.id">
                <option value="">Toda la organización</option>
                @for (e of empresas(); track e.id) { <option [value]="e.id">{{ e.name }}</option> }
              </select>
              @if (d.id) { <span class="hint">La empresa no se cambia tras crear la dimensión.</span> }
            </div>
          </div>
          <div class="grid grid-3">
            <div class="field">
              <label for="dd-tipo">Tipo de valor</label>
              <select id="dd-tipo" class="input" [(ngModel)]="d.tipoValor" [disabled]="!!d.id">
                @for (t of tipos; track t) { <option [value]="t">{{ tipoValorLabel(t) }}</option> }
              </select>
              <span class="hint">{{ tipoMeta[d.tipoValor].descripcion }}</span>
            </div>
            @if (d.tipoValor === 'REFERENCIA') {
              <div class="field">
                <label for="dd-ref">Entidad referida</label>
                <select id="dd-ref" class="input" [(ngModel)]="d.referenciaEntidad" [disabled]="!!d.id">
                  <option value="">— Elegir —</option>
                  @for (r of referencias; track r.id) { <option [value]="r.id">{{ r.label }}</option> }
                </select>
              </div>
            }
            @if (d.tipoValor === 'LISTA') {
              <div class="field">
                <label for="dd-jer">Jerárquica</label>
                <label class="check"><input id="dd-jer" type="checkbox" [(ngModel)]="d.jerarquica" /> Sus valores forman árbol (roll-up)</label>
              </div>
            }
          </div>
          <div class="field">
            <label>Aplica a</label>
            <div class="chips">
              @for (o of aplicaOpciones; track o.id) {
                <label class="chip" [class.on]="d.aplicaA.includes(o.id)">
                  <input type="checkbox" [checked]="d.aplicaA.includes(o.id)" (change)="toggleAplica(d, o.id)" />{{ o.label }}
                </label>
              }
            </div>
            <span class="hint">Entidades/acciones que podrán etiquetarse con esta dimensión.</span>
          </div>
          <div class="grid grid-3">
            <div class="field">
              <label>Obligatoriedad</label>
              <label class="check"><input type="checkbox" [(ngModel)]="d.obligatoria" /> Obligatoria</label>
              <label class="check"><input type="checkbox" [(ngModel)]="d.obligatoriaParaEfectoEconomico" /> Obligatoria para efecto económico</label>
            </div>
            <div class="field">
              <label for="dd-est">Estado</label>
              <select id="dd-est" class="input" [(ngModel)]="d.estado">
                @for (e of estados; track e) { <option [value]="e">{{ estadoMeta[e].label }}</option> }
              </select>
            </div>
            <div></div>
          </div>
          <div class="grid grid-2">
            <div class="field"><label for="dd-desde">Vigente desde</label><input id="dd-desde" class="input" type="date" [(ngModel)]="d.vigenteDesde" /></div>
            <div class="field"><label for="dd-hasta">Vigente hasta</label><input id="dd-hasta" class="input" type="date" [(ngModel)]="d.vigenteHasta" /></div>
          </div>
          <div class="row">
            <span class="spacer"></span>
            <button class="btn" (click)="draft.set(null)">Cancelar</button>
            <button class="btn primary" [disabled]="busy() || invalid(d)" (click)="save()"><nx-icon name="save" />{{ d.id ? 'Guardar' : 'Crear' }}</button>
          </div>
        </div>
      }

      @if (!items().length) {
        <nx-empty-state
          icon="layers"
          title="Sin dimensiones"
          description="Define dimensiones para clasificar y analizar el trabajo (proyecto, cliente, producto, campaña…)."
          [actionLabel]="canEdit() ? 'Nueva dimensión' : ''"
          actionIcon="plus"
          (action)="startCreate()" />
      } @else {
        <div class="card" style="padding:0">
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Ámbito</th><th>Aplica a</th><th>Estado</th><th>Origen</th><th></th></tr>
              </thead>
              <tbody>
                @for (dim of items(); track dim.id) {
                  <tr [class.selected]="selectedId() === dim.id || draft()?.id === dim.id">
                    <td class="mono small nowrap">{{ dim.codigo }}</td>
                    <td>
                      <strong>{{ dim.nombre }}</strong>
                      @if (dim.obligatoriaParaEfectoEconomico) { <span class="badge warning" title="Obligatoria al registrar efecto económico">Efecto econ.</span> }
                      @else if (dim.obligatoria) { <span class="badge">Obligatoria</span> }
                    </td>
                    <td class="small">
                      {{ tipoValorLabel(dim.tipoValor) }}
                      @if (dim.tipoValor === 'REFERENCIA') { <div class="muted small">→ {{ referenciaLabel(dim.referenciaEntidad) }}</div> }
                      @else if (dim.tipoValor === 'LISTA' && dim.jerarquica) { <div class="muted small">árbol</div> }
                    </td>
                    <td class="small">{{ dim.empresaId ? empresaDe(dim.empresaId) : 'Organización' }}</td>
                    <td class="small">{{ aplicaResumen(dim) }}</td>
                    <td><span [class]="badgeClass(estadoMeta[dim.estado].tono)">{{ estadoMeta[dim.estado].label }}</span></td>
                    <td>
                      @if (dim.esSistema) { <span class="badge info" title="Dimensión integrada, solo lectura"><nx-icon name="lock" [size]="12" /> Sistema</span> }
                      @else { <span class="badge">Cliente</span> }
                    </td>
                    <td class="num nowrap">
                      @if (dim.tipoValor === 'LISTA') {
                        <button class="btn ghost icon sm" [title]="selectedId() === dim.id ? 'Ocultar valores' : 'Ver valores'"
                          [attr.aria-label]="selectedId() === dim.id ? 'Ocultar valores' : 'Ver valores'" (click)="toggleValores(dim)">
                          <nx-icon name="list" [size]="14" />
                        </button>
                      }
                      @if (canEdit() && !dim.esSistema) {
                        <button class="btn ghost icon sm" title="Editar dimensión" aria-label="Editar dimensión" (click)="startEdit(dim)"><nx-icon name="pencil" [size]="14" /></button>
                        <button class="btn ghost icon sm danger" title="Eliminar dimensión" aria-label="Eliminar dimensión" (click)="remove(dim)"><nx-icon name="trash" [size]="14" /></button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>

        @if (selected(); as dim) {
          <nx-valores-arbol [dimension]="dim" [canEdit]="canEdit()" />
        }
      }
    }
  `,
  styles: `
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border: 1px solid var(--border); border-radius: 999px; font-size: 13px; cursor: pointer; }
    .chip.on { border-color: var(--primary); color: var(--primary); background: color-mix(in srgb, var(--primary) 8%, transparent); }
    .chip input { margin: 0; }
    .check { display: flex; align-items: center; gap: 7px; font-weight: 500; font-size: 13.5px; cursor: pointer; }
  `,
})
export class CatalogoDimensionesComponent implements OnInit {
  private readonly api = inject(DimensionesApi);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);

  readonly empresas = input.required<OrgUnit[]>();

  readonly tipos = DIMENSION_TIPOS_VALOR;
  readonly tipoMeta = TIPO_VALOR_META;
  readonly referencias = REFERENCIA_META;
  readonly aplicaOpciones = APLICA_A_OPCIONES;
  readonly estados = ESTADOS;
  readonly estadoMeta = ESTADO_META;
  readonly badgeClass = badgeClass;
  readonly tipoValorLabel = tipoValorLabel;
  readonly referenciaLabel = referenciaLabel;

  readonly items = signal<Dimension[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly filtro = signal<string>('');
  readonly draft = signal<Draft | null>(null);
  readonly busy = signal(false);
  readonly selectedId = signal<string | null>(null);

  readonly canEdit = computed(() => this.auth.canEdit());
  readonly selected = computed(() => this.items().find((d) => d.id === this.selectedId()) ?? null);

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.items.set(await this.api.dimensiones(this.filtro() || undefined));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  onFiltro(v: string) {
    this.filtro.set(v);
    this.selectedId.set(null);
    void this.load();
  }

  empresaDe(id: string) {
    return empresaNombre(this.empresas(), id);
  }

  aplicaResumen(dim: Dimension) {
    return dim.aplicaA.length ? dim.aplicaA.join(', ') : '—';
  }

  toggleValores(dim: Dimension) {
    this.selectedId.update((id) => (id === dim.id ? null : dim.id));
  }

  toggleAplica(d: Draft, id: string) {
    d.aplicaA = d.aplicaA.includes(id) ? d.aplicaA.filter((x) => x !== id) : [...d.aplicaA, id];
  }

  startCreate() {
    this.draft.set({
      id: null,
      codigo: '',
      nombre: '',
      empresaId: this.filtro() || '',
      tipoValor: 'LISTA',
      referenciaEntidad: '',
      jerarquica: false,
      obligatoria: false,
      obligatoriaParaEfectoEconomico: false,
      aplicaA: ['ejecucion'],
      estado: 'ACTIVA',
      vigenteDesde: '',
      vigenteHasta: '',
    });
  }

  startEdit(dim: Dimension) {
    this.draft.set({
      id: dim.id,
      codigo: dim.codigo,
      nombre: dim.nombre,
      empresaId: dim.empresaId ?? '',
      tipoValor: dim.tipoValor,
      referenciaEntidad: dim.referenciaEntidad ?? '',
      jerarquica: dim.jerarquica,
      obligatoria: dim.obligatoria,
      obligatoriaParaEfectoEconomico: dim.obligatoriaParaEfectoEconomico,
      aplicaA: [...dim.aplicaA],
      estado: dim.estado,
      vigenteDesde: dim.vigenteDesde?.slice(0, 10) ?? '',
      vigenteHasta: dim.vigenteHasta?.slice(0, 10) ?? '',
    });
  }

  invalid(d: Draft) {
    if (d.codigo.trim().length < 1 || d.nombre.trim().length < 2) return true;
    if (!d.id && d.tipoValor === 'REFERENCIA' && !d.referenciaEntidad) return true;
    return false;
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
      const comun = {
        nombre: d.nombre.trim(),
        jerarquica: d.tipoValor === 'LISTA' ? d.jerarquica : false,
        obligatoria: d.obligatoria,
        obligatoriaParaEfectoEconomico: d.obligatoriaParaEfectoEconomico,
        aplicaA: d.aplicaA,
        estado: d.estado,
        vigenteDesde: d.vigenteDesde || null,
        vigenteHasta: d.vigenteHasta || null,
      };
      if (d.id) {
        await this.api.updateDimension(d.id, comun);
      } else {
        await this.api.createDimension({
          codigo: d.codigo.trim(),
          empresaId: d.empresaId || null,
          tipoValor: d.tipoValor,
          referenciaEntidad: d.tipoValor === 'REFERENCIA' ? d.referenciaEntidad : null,
          ...comun,
        });
      }
      this.toast.success(d.id ? 'Dimensión actualizada' : 'Dimensión creada');
      this.draft.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async remove(dim: Dimension) {
    if (!confirm(`¿Eliminar la dimensión "${dim.nombre}"? Se borrarán sus valores y etiquetas.`)) return;
    try {
      await this.api.deleteDimension(dim.id);
      this.toast.success('Dimensión eliminada');
      if (this.draft()?.id === dim.id) this.draft.set(null);
      if (this.selectedId() === dim.id) this.selectedId.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
