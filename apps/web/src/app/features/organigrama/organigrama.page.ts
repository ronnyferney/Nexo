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
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { HierarchyApi } from '../../core/hierarchy.api';
import type { CadenaMando, NodoArbol, NodoOrganigrama } from '../../core/hierarchy.models';
import { NIVEL_LABELS } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { PageHeaderComponent } from '../../layout/page-header.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { hasIcon, IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import {
  aplanarVisible,
  candidatosSupervisor,
  contarAgentes,
  puedeReasignar,
  traducirErrorJerarquia,
} from './organigrama.util';

/** Borrador del formulario de reasignación de supervisor. */
interface ReasignarDraft {
  agente: NodoOrganigrama;
  /** Id del supervisor destino; cadena vacía = sin supervisor (raíz). */
  supervisorId: string;
}

/**
 * Organigrama visual de empleados digitales (E3/RF32): árbol con sangría de la línea de mando. Cada nodo muestra icono,
 * nombre, cargo + nivel y responsable. Un ADMIN puede reasignar el supervisor de cualquier agente; el backend valida la
 * estructura (sin ciclos, nivel coherente, mismo workspace) y los rechazos se muestran traducidos. Cualquier miembro
 * puede consultar la cadena de mando ascendente de un agente.
 */
@Component({
  selector: 'nx-organigrama',
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
      <nx-page-header
        heading="Organigrama"
        description="Línea de mando de sus empleados digitales: quién reporta a quién. Las raíces son los agentes sin supervisor."
      >
        <div actions>
          @if (!loading() && !error() && raices().length) {
            <button class="btn sm" (click)="toggleTodo()">
              <nx-icon [name]="todoColapsado() ? 'chevronDown' : 'chevronUp'" [size]="15" />
              {{ todoColapsado() ? 'Expandir todo' : 'Colapsar todo' }}
            </button>
          }
        </div>
      </nx-page-header>

      @if (error()) {
        <nx-error-state message="{{ error() }}" title="No se pudo cargar el organigrama" (retry)="load()" />
      } @else if (loading()) {
        <nx-loading-state text="Cargando el organigrama…" />
      } @else if (!raices().length) {
        <nx-empty-state
          icon="orgchart"
          title="Sin empleados digitales"
          description="Aún no hay agentes en este espacio de trabajo. Cree agentes para definir su línea de mando."
        />
      } @else {
        <p class="muted small total">{{ total() }} empleado(s) digital(es) en el organigrama.</p>
        <div class="card tree" role="tree" aria-label="Organigrama de empleados digitales">
          @for (fila of filas(); track fila.nodo.id) {
            <div
              class="row"
              role="treeitem"
              [attr.aria-level]="fila.profundidad + 1"
              [attr.aria-expanded]="fila.tieneHijos ? !colapsados().has(fila.nodo.id) : null"
              [style.padding-left.px]="12 + fila.profundidad * 22"
            >
              @if (fila.tieneHijos) {
                <button
                  class="btn sm icon toggle"
                  [title]="colapsados().has(fila.nodo.id) ? 'Expandir' : 'Colapsar'"
                  [attr.aria-label]="colapsados().has(fila.nodo.id) ? 'Expandir subordinados' : 'Colapsar subordinados'"
                  (click)="toggle(fila.nodo.id)"
                >
                  <nx-icon [name]="colapsados().has(fila.nodo.id) ? 'chevronDown' : 'chevronUp'" [size]="14" />
                </button>
              } @else {
                <span class="toggle-spacer" aria-hidden="true"></span>
              }
              <span class="node-icon"><nx-icon [name]="iconoDe(fila.nodo)" [size]="18" /></span>
              <div class="node-main">
                <div class="node-title">
                  <span class="name">{{ fila.nodo.nombre }}</span>
                  <span class="badge">{{ nivelLabels[fila.nodo.nivel] }}</span>
                  @if (fila.nodo.cargo) {
                    <span class="muted small cargo">{{ fila.nodo.cargo.nombre }}</span>
                  }
                </div>
                <div class="node-meta muted small">
                  @if (fila.nodo.responsable) {
                    <span><nx-icon name="user" [size]="12" /> {{ fila.nodo.responsable.nombre }}</span>
                  } @else {
                    <span>Sin responsable humano</span>
                  }
                </div>
              </div>
              <div class="node-actions">
                <button
                  class="btn sm icon"
                  title="Ver cadena de mando"
                  aria-label="Ver cadena de mando"
                  (click)="verCadena(fila.nodo)"
                >
                  <nx-icon name="list" [size]="15" />
                </button>
                @if (puedeEditar()) {
                  <button class="btn sm" (click)="openReasignar(fila.nodo)">
                    <nx-icon name="shuffle" [size]="14" />Reasignar
                  </button>
                }
              </div>
            </div>
          }
        </div>
      }
    </div>

    @if (draft(); as d) {
      <dialog #dlgReasignar class="modal" aria-labelledby="reasignar-title" (cancel)="onCancel($event)" (close)="draft.set(null)">
        <form (ngSubmit)="guardar()">
          <div class="modal-head">
            <div class="icon-tile"><nx-icon name="shuffle" /></div>
            <div class="grow">
              <h2 id="reasignar-title">Reasignar supervisor</h2>
              <span class="small muted">¿A quién reporta «{{ d.agente.nombre }}»?</span>
            </div>
          </div>
          <div class="modal-body">
            <div class="field">
              <label for="reasignar-supervisor">Supervisor</label>
              <select
                id="reasignar-supervisor"
                class="input"
                [ngModel]="d.supervisorId"
                (ngModelChange)="patch($event)"
                name="supervisor"
              >
                <option value="">Sin supervisor (raíz del organigrama)</option>
                @for (c of candidatos(); track c.id) {
                  <option [value]="c.id">{{ c.nombre }} — {{ nivelLabels[c.nivel] }}</option>
                }
              </select>
              <span class="hint">
                No aparecen el propio agente ni sus subordinados (crearían un ciclo). El supervisor debe tener un nivel
                igual o superior.
              </span>
            </div>
            @if (formError()) {
              <div class="callout danger" role="alert"><nx-icon name="alert" [size]="16" /><span>{{ formError() }}</span></div>
            }
          </div>
          <div class="modal-foot">
            <button type="button" class="btn" (click)="close()">Cancelar</button>
            <button type="submit" class="btn primary" [disabled]="busy() || d.supervisorId === (d.agente.reportaAAgentId ?? '')">
              <nx-icon name="save" [size]="16" />{{ busy() ? 'Guardando…' : 'Guardar' }}
            </button>
          </div>
        </form>
      </dialog>
    }

    @if (cadena(); as c) {
      <dialog #dlgCadena class="modal" aria-labelledby="cadena-title" (close)="cadena.set(null)">
        <div class="modal-head">
          <div class="icon-tile"><nx-icon name="list" /></div>
          <div class="grow">
            <h2 id="cadena-title">Cadena de mando</h2>
            <span class="small muted">De «{{ c.agente.nombre }}» hacia la raíz.</span>
          </div>
        </div>
        <div class="modal-body">
          @if (cadenaLoading()) {
            <nx-loading-state text="Cargando la cadena de mando…" size="sm" />
          } @else if (cadenaError()) {
            <div class="callout danger" role="alert"><nx-icon name="alert" [size]="16" /><span>{{ cadenaError() }}</span></div>
          } @else if (!c.cadena.length) {
            <p class="muted">Este agente es una raíz: no reporta a nadie.</p>
          } @else {
            <ol class="cadena">
              @for (n of c.cadena; track n.id; let i = $index) {
                <li>
                  <span class="paso">{{ i + 1 }}</span>
                  <span class="node-icon"><nx-icon [name]="iconoDe(n)" [size]="16" /></span>
                  <span class="name">{{ n.nombre }}</span>
                  <span class="badge">{{ nivelLabels[n.nivel] }}</span>
                </li>
              }
            </ol>
          }
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" (click)="closeCadena()">Cerrar</button>
        </div>
      </dialog>
    }
  `,
  styles: `
    .total { margin: 0 0 12px; }
    .tree { padding: 6px; display: flex; flex-direction: column; }
    .row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 9px; }
    .row:hover { background: var(--surface-2, rgba(127, 127, 127, 0.07)); }
    .toggle { flex-shrink: 0; }
    .toggle-spacer { width: 24px; flex-shrink: 0; }
    .node-icon { display: inline-flex; color: var(--muted); flex-shrink: 0; }
    .node-main { flex: 1; min-width: 0; }
    .node-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .node-title .name { font-weight: 600; overflow-wrap: anywhere; }
    .node-meta { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
    .node-meta nx-icon { vertical-align: -2px; }
    .node-actions { display: flex; gap: 6px; flex-shrink: 0; }
    .cargo { overflow-wrap: anywhere; }
    .hint { font-size: 12px; color: var(--muted); }
    .cadena { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .cadena li { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 9px; }
    .cadena .paso { width: 22px; height: 22px; border-radius: 50%; background: var(--surface-2, rgba(127, 127, 127, 0.12)); display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; flex-shrink: 0; }
    .cadena .name { font-weight: 600; flex: 1; overflow-wrap: anywhere; }
    @media (max-width: 560px) {
      .node-actions .btn:not(.icon) span { display: none; }
    }
  `,
})
export class OrganigramaPage implements OnInit {
  private readonly api = inject(HierarchyApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly dlgReasignar = viewChild<ElementRef<HTMLDialogElement>>('dlgReasignar');
  private readonly dlgCadena = viewChild<ElementRef<HTMLDialogElement>>('dlgCadena');

  readonly nivelLabels = NIVEL_LABELS;
  readonly puedeEditar = computed(() => puedeReasignar(this.auth.isAdmin()));

  readonly raices = signal<NodoArbol[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly colapsados = signal<ReadonlySet<string>>(new Set());

  readonly total = computed(() => contarAgentes(this.raices()));
  readonly filas = computed(() => aplanarVisible(this.raices(), this.colapsados()));
  readonly todoColapsado = computed(() => this.colapsados().size > 0);

  // Reasignación de supervisor (ADMIN)
  readonly draft = signal<ReasignarDraft | null>(null);
  readonly formError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly candidatos = computed(() => {
    const d = this.draft();
    return d ? candidatosSupervisor(this.raices(), d.agente.id) : [];
  });

  // Cadena de mando (cualquier rol)
  readonly cadena = signal<{ agente: NodoOrganigrama; cadena: NodoOrganigrama[] } | null>(null);
  readonly cadenaLoading = signal(false);
  readonly cadenaError = signal<string | null>(null);

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.raices.set(await this.api.organigrama());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  iconoDe(n: NodoOrganigrama): string {
    return hasIcon(n.icono) ? n.icono! : 'bot';
  }

  toggle(id: string) {
    this.colapsados.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Colapsa todos los nodos con subordinados, o los expande todos si ya había alguno colapsado. */
  toggleTodo() {
    if (this.todoColapsado()) {
      this.colapsados.set(new Set());
    } else {
      const conHijos = aplanarVisible(this.raices(), new Set())
        .filter((f) => f.tieneHijos)
        .map((f) => f.nodo.id);
      this.colapsados.set(new Set(conHijos));
    }
  }

  openReasignar(agente: NodoOrganigrama) {
    if (!this.puedeEditar()) return;
    this.formError.set(null);
    this.draft.set({ agente, supervisorId: agente.reportaAAgentId ?? '' });
    afterNextRender(() => this.dlgReasignar()?.nativeElement.showModal(), { injector: this.injector });
  }

  patch(supervisorId: string) {
    this.draft.update((d) => (d ? { ...d, supervisorId } : d));
  }

  close() {
    if (!this.busy()) this.dlgReasignar()?.nativeElement.close();
  }

  onCancel(ev: Event) {
    if (this.busy()) ev.preventDefault();
  }

  async guardar() {
    const d = this.draft();
    if (!d || this.busy()) return;
    const destino = d.supervisorId || null;
    if (destino === (d.agente.reportaAAgentId ?? null)) return;
    this.busy.set(true);
    this.formError.set(null);
    try {
      await this.api.setSupervisor(d.agente.id, destino);
      this.busy.set(false);
      this.dlgReasignar()?.nativeElement.close();
      this.toast.success(
        destino
          ? `«${d.agente.nombre}» ahora reporta a su nuevo supervisor`
          : `«${d.agente.nombre}» queda como raíz del organigrama`,
      );
      await this.load();
    } catch (e) {
      this.formError.set(traducirErrorJerarquia(errorMessage(e)));
      this.busy.set(false);
    }
  }

  async verCadena(agente: NodoOrganigrama) {
    this.cadena.set({ agente, cadena: [] });
    this.cadenaError.set(null);
    this.cadenaLoading.set(true);
    afterNextRender(() => this.dlgCadena()?.nativeElement.showModal(), { injector: this.injector });
    try {
      const res: CadenaMando = await this.api.cadenaMando(agente.id);
      this.cadena.set({ agente, cadena: res.cadena });
    } catch (e) {
      this.cadenaError.set(errorMessage(e));
    } finally {
      this.cadenaLoading.set(false);
    }
  }

  closeCadena() {
    this.dlgCadena()?.nativeElement.close();
  }
}
