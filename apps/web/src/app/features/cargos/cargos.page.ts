import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  Injector,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import {
  type Cargo,
  type CargoInput,
  NIVEL_LABELS,
  NIVELES_JERARQUICOS,
  type NivelJerarquico,
} from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { PageHeaderComponent } from '../../layout/page-header.component';

/** Borrador del formulario de cargo: las listas se editan como texto (un elemento por línea). */
interface CargoDraft {
  id: string | null;
  nombre: string;
  nivel: NivelJerarquico;
  proposito: string;
  funciones: string;
  entregables: string;
  indicadores: string;
  limites: string;
  activo: boolean;
}

/** Texto multilínea → lista de elementos no vacíos (recortados). */
function linesToList(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

const listToLines = (list: string[]): string => list.join('\n');

/**
 * Catálogo de cargos del empleado digital (E2/RF03): perfil reutilizable con propósito, funciones, entregables,
 * indicadores, límites y nivel jerárquico. Lectura para cualquier miembro; crear/editar/eliminar requiere EDITOR+.
 */
@Component({
  selector: 'nx-cargos',
  imports: [
    FormsModule,
    IconComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    LoadingStateComponent,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nx-page-header heading="Cargos" description="Perfiles reutilizables del empleado digital: propósito, funciones, entregables, indicadores, límites y nivel jerárquico">
        <div actions>
          @if (canEdit()) {
            <button class="btn primary brand" (click)="openCreate()"><nx-icon name="plus" />Nuevo cargo</button>
          }
        </div>
      </nx-page-header>

      @if (error()) {
        <nx-error-state message="{{ error() }}" title="No se pudieron cargar los cargos" (retry)="load()" />
      } @else if (loading()) {
        <nx-loading-state text="Cargando el catálogo de cargos…" />
      } @else if (!cargos().length) {
        <nx-empty-state icon="layers" title="Sin cargos"
          description="Aún no hay cargos en el catálogo. Defina perfiles reutilizables para sus empleados digitales."
          [actionLabel]="canEdit() ? 'Nuevo cargo' : ''" actionIcon="plus" (action)="openCreate()" />
      } @else {
        <div class="cargos">
          @for (c of sorted(); track c.id) {
            <div class="card cargo-card">
              <div class="c-head">
                <div class="grow">
                  <div class="title-row">
                    <h2>{{ c.nombre }}</h2>
                    <span class="badge">{{ nivelLabels[c.nivel] }}</span>
                    @if (!c.activo) { <span class="badge warning">Inactivo</span> }
                  </div>
                  @if (c.proposito) { <p class="muted small m0">{{ c.proposito }}</p> }
                </div>
                @if (canEdit()) {
                  <div class="row">
                    <button class="btn sm icon" title="Editar cargo" aria-label="Editar cargo" (click)="openEdit(c)"><nx-icon name="pencil" [size]="15" /></button>
                    <button class="btn sm icon danger" title="Eliminar cargo" aria-label="Eliminar cargo" [disabled]="deletingId() === c.id" (click)="remove(c)"><nx-icon name="trash" [size]="15" /></button>
                  </div>
                }
              </div>
              <dl class="facets">
                <div><dt><nx-icon name="list" [size]="13" />Funciones</dt><dd>{{ c.funciones.length }}</dd></div>
                <div><dt><nx-icon name="flag" [size]="13" />Entregables</dt><dd>{{ c.entregables.length }}</dd></div>
                <div><dt><nx-icon name="chart" [size]="13" />Indicadores</dt><dd>{{ c.indicadores.length }}</dd></div>
                <div><dt><nx-icon name="shield" [size]="13" />Límites</dt><dd>{{ c.limites.length }}</dd></div>
                <div><dt><nx-icon name="bot" [size]="13" />Agentes</dt><dd>{{ c.agentsCount }}</dd></div>
              </dl>
            </div>
          }
        </div>
      }
    </div>

    @if (draft(); as d) {
      <dialog #dlg class="modal" aria-labelledby="cargo-title" (cancel)="onCancel($event)" (close)="draft.set(null)">
        <form (ngSubmit)="save()">
          <div class="modal-head">
            <div class="icon-tile"><nx-icon name="layers" /></div>
            <div class="grow"><h2 id="cargo-title">{{ d.id ? 'Editar cargo' : 'Nuevo cargo' }}</h2>
              <span class="small muted">Defina el perfil; podrá asignarlo a sus empleados digitales desde el expediente de cada agente.</span></div>
          </div>
          <div class="modal-body">
            <div class="grid-2">
              <div class="field"><label for="cargo-nombre">Nombre <abbr class="req" title="Obligatorio" aria-hidden="true">*</abbr></label>
                <input id="cargo-nombre" class="input" required maxlength="120" [ngModel]="d.nombre" (ngModelChange)="patch({ nombre: $event })" name="nombre" />
              </div>
              <div class="field"><label for="cargo-nivel">Nivel jerárquico</label>
                <select id="cargo-nivel" class="input" [ngModel]="d.nivel" (ngModelChange)="patch({ nivel: $event })" name="nivel">
                  @for (n of niveles; track n) { <option [value]="n">{{ nivelLabels[n] }}</option> }
                </select>
              </div>
            </div>
            <div class="field"><label for="cargo-proposito">Propósito</label>
              <textarea id="cargo-proposito" class="input" rows="2" maxlength="2000" [ngModel]="d.proposito" (ngModelChange)="patch({ proposito: $event })" name="proposito"
                placeholder="La misión del cargo en una o dos frases"></textarea>
            </div>
            <div class="grid-2">
              <div class="field"><label for="cargo-funciones">Funciones</label>
                <span class="hint">Una por línea.</span>
                <textarea id="cargo-funciones" class="input" rows="4" [ngModel]="d.funciones" (ngModelChange)="patch({ funciones: $event })" name="funciones"></textarea>
              </div>
              <div class="field"><label for="cargo-entregables">Entregables</label>
                <span class="hint">Uno por línea.</span>
                <textarea id="cargo-entregables" class="input" rows="4" [ngModel]="d.entregables" (ngModelChange)="patch({ entregables: $event })" name="entregables"></textarea>
              </div>
              <div class="field"><label for="cargo-indicadores">Indicadores</label>
                <span class="hint">Uno por línea.</span>
                <textarea id="cargo-indicadores" class="input" rows="4" [ngModel]="d.indicadores" (ngModelChange)="patch({ indicadores: $event })" name="indicadores"></textarea>
              </div>
              <div class="field"><label for="cargo-limites">Límites</label>
                <span class="hint">Lo que el cargo NO debe hacer. Uno por línea.</span>
                <textarea id="cargo-limites" class="input" rows="4" [ngModel]="d.limites" (ngModelChange)="patch({ limites: $event })" name="limites"></textarea>
              </div>
            </div>
            <label class="checkbox"><input type="checkbox" [ngModel]="d.activo" (ngModelChange)="patch({ activo: $event })" name="activo" />
              <span>Activo <span class="muted small">(un cargo inactivo deja de ofrecerse para asignar)</span></span></label>
            @if (formError()) {
              <div class="callout danger" role="alert"><nx-icon name="alert" [size]="16" /><span>{{ formError() }}</span></div>
            }
          </div>
          <div class="modal-foot">
            <button type="button" class="btn" (click)="close()">Cancelar</button>
            <button type="submit" class="btn primary" [disabled]="busy() || d.nombre.trim().length < 2">
              <nx-icon name="save" [size]="16" />{{ busy() ? 'Guardando…' : d.id ? 'Guardar' : 'Crear cargo' }}</button>
          </div>
        </form>
      </dialog>
    }
  `,
  styles: `
    .cargos { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); align-items: start; }
    .cargo-card { display: flex; flex-direction: column; gap: 12px; }
    .c-head { display: flex; gap: 12px; align-items: flex-start; }
    .grow { flex: 1; min-width: 0; }
    .title-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 4px; }
    .title-row h2 { margin: 0; font-size: 16px; overflow-wrap: anywhere; }
    .m0 { margin: 0; }
    .facets { display: grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap: 8px; margin: 0; }
    .facets div { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 9px; }
    .facets dt { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--muted); font-weight: 600; }
    .facets dt nx-icon { color: var(--muted); }
    .facets dd { margin: 0; font-size: 18px; font-weight: 700; }
    .modal-body { display: flex; flex-direction: column; gap: 14px; }
    .grid-2 { display: grid; gap: 14px; grid-template-columns: 1fr 1fr; }
    .hint { font-size: 12px; color: var(--muted); }
    @media (max-width: 560px) { .cargos { grid-template-columns: 1fr; } .grid-2 { grid-template-columns: 1fr; } }
  `,
})
export class CargosPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  readonly nivelLabels = NIVEL_LABELS;
  readonly niveles = NIVELES_JERARQUICOS;
  readonly canEdit = this.auth.canEdit;

  readonly cargos = signal<Cargo[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly deletingId = signal<string | null>(null);

  readonly draft = signal<CargoDraft | null>(null);
  readonly formError = signal<string | null>(null);

  /** Mayor nivel primero, luego por nombre (como el catálogo del backend). */
  readonly sorted = computed(() => {
    const order = new Map(this.niveles.map((n, i) => [n, i]));
    return [...this.cargos()].sort(
      (a, b) => (order.get(b.nivel) ?? 0) - (order.get(a.nivel) ?? 0) || a.nombre.localeCompare(b.nombre, 'es'),
    );
  });

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.cargos.set(await this.api.cargos());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  openCreate() {
    if (!this.canEdit()) return;
    this.open({
      id: null,
      nombre: '',
      nivel: 'EMPLEADO',
      proposito: '',
      funciones: '',
      entregables: '',
      indicadores: '',
      limites: '',
      activo: true,
    });
  }

  openEdit(c: Cargo) {
    if (!this.canEdit()) return;
    this.open({
      id: c.id,
      nombre: c.nombre,
      nivel: c.nivel,
      proposito: c.proposito ?? '',
      funciones: listToLines(c.funciones),
      entregables: listToLines(c.entregables),
      indicadores: listToLines(c.indicadores),
      limites: listToLines(c.limites),
      activo: c.activo,
    });
  }

  private open(d: CargoDraft) {
    this.formError.set(null);
    this.draft.set(d);
    afterNextRender(() => this.dialog()?.nativeElement.showModal(), { injector: this.injector });
  }

  patch(part: Partial<CargoDraft>) {
    this.draft.update((d) => (d ? { ...d, ...part } : d));
  }

  close() {
    if (!this.busy()) this.dialog()?.nativeElement.close();
  }

  onCancel(ev: Event) {
    if (this.busy()) ev.preventDefault();
  }

  async save() {
    const d = this.draft();
    if (!d || this.busy() || d.nombre.trim().length < 2) return;
    this.busy.set(true);
    this.formError.set(null);
    const payload: CargoInput = {
      nombre: d.nombre.trim(),
      proposito: d.proposito.trim() || null,
      funciones: linesToList(d.funciones),
      entregables: linesToList(d.entregables),
      indicadores: linesToList(d.indicadores),
      limites: linesToList(d.limites),
      nivel: d.nivel,
      activo: d.activo,
    };
    try {
      if (!d.id) {
        const created = await this.api.createCargo(payload);
        this.cargos.update((l) => [...l, created]);
        this.toast.success(`Cargo «${created.nombre}» creado`);
      } else {
        const updated = await this.api.updateCargo(d.id, payload);
        this.cargos.update((l) => l.map((c) => (c.id === updated.id ? updated : c)));
        this.toast.success('Cargo actualizado');
      }
      this.busy.set(false);
      this.dialog()?.nativeElement.close();
    } catch (e) {
      this.formError.set(errorMessage(e));
      this.busy.set(false);
    }
  }

  async remove(c: Cargo) {
    if (this.deletingId()) return;
    const warn = c.agentsCount
      ? `\n\n${c.agentsCount} agente(s) tienen este cargo; quedarán sin cargo asignado.`
      : '';
    if (!confirm(`¿Eliminar el cargo «${c.nombre}»?${warn}\n\nEsta acción no se puede deshacer.`)) return;
    this.deletingId.set(c.id);
    try {
      await this.api.deleteCargo(c.id);
      this.cargos.update((l) => l.filter((x) => x.id !== c.id));
      this.toast.success(`Cargo «${c.nombre}» eliminado`);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.deletingId.set(null);
    }
  }
}
