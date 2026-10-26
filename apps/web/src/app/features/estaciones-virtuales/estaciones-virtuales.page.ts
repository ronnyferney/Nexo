import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/api.service';
import { ExecutionParamsApi } from '../../core/execution-params.api';
import type { EstacionVirtual } from '../../core/execution-params.models';
import { ToastService } from '../../core/toast.service';
import { PageHeaderComponent } from '../../layout/page-header.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { estadoEstacionBadgeClass, estadoEstacionLabel, puedeAdministrarEstaciones, validarNombreEstacion } from '../agents/execution-params.util';

/** Borrador del formulario de alta/edición de una estación virtual. */
interface Draft {
  id: string | null;
  nombre: string;
  descripcion: string;
  proveedor: string;
}

const EMPTY_DRAFT: Draft = { id: null, nombre: '', descripcion: '', proveedor: '' };

/**
 * Administración de estaciones virtuales (E8): recurso del workspace que representa la máquina (real o lógica)
 * asignable a un empleado digital. Listar es para cualquier miembro, pero esta página vive en Administración y el
 * crear/editar/retirar lo reservan backend (ADMIN+) y el gate de rol de la UI. NUNCA guarda credenciales: `proveedor`
 * es solo una etiqueta.
 */
@Component({
  selector: 'nx-estaciones-virtuales',
  imports: [FormsModule, PageHeaderComponent, IconComponent, LoadingStateComponent, ErrorStateComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nx-page-header
        heading="Estaciones virtuales"
        description="Estaciones de trabajo (máquinas reales o lógicas) que se asignan a los empleados digitales. El proveedor es solo una etiqueta; nunca se guardan credenciales."
        [crumbs]="[{ label: 'Administración', link: '/admin' }, { label: 'Estaciones virtuales' }]">
        @if (canManage()) {
          <button actions class="btn primary" [disabled]="!!draft()" (click)="nueva()">
            <nx-icon name="plus" [size]="16" />Nueva estación
          </button>
        }
      </nx-page-header>

      @if (draft(); as d) {
        <form class="card stack editor" (ngSubmit)="guardar()">
          <h3 class="m0">{{ d.id ? 'Editar estación' : 'Nueva estación virtual' }}</h3>
          <div class="field">
            <label for="ev-nombre">Nombre <abbr class="req" title="Campo obligatorio" aria-hidden="true">*</abbr></label>
            <input id="ev-nombre" class="input" maxlength="120" required [attr.aria-invalid]="nombreError() ? 'true' : null"
              [ngModel]="d.nombre" name="nombre" (ngModelChange)="patch({ nombre: $event }); touched.set(true)" />
            @if (touched() && nombreError(); as err) {
              <span class="field-error" role="alert"><nx-icon name="alert" [size]="12" />{{ err }}</span>
            }
          </div>
          <div class="field">
            <label for="ev-proveedor">Proveedor (etiqueta)</label>
            <input id="ev-proveedor" class="input" maxlength="120" placeholder="interna, azure, aws…" [ngModel]="d.proveedor" name="proveedor" (ngModelChange)="patch({ proveedor: $event })" />
            <span class="hint">Solo una etiqueta descriptiva. No escriba credenciales ni secretos aquí.</span>
          </div>
          <div class="field">
            <label for="ev-desc">Descripción</label>
            <textarea id="ev-desc" class="input" rows="2" maxlength="2000" [ngModel]="d.descripcion" name="descripcion" (ngModelChange)="patch({ descripcion: $event })"></textarea>
          </div>
          <div class="row wrap">
            <span class="spacer"></span>
            <button type="button" class="btn" [disabled]="saving()" (click)="cancelar()">Cancelar</button>
            <button type="submit" class="btn primary" [disabled]="saving() || !!nombreError()">
              <nx-icon name="save" [size]="16" />{{ saving() ? 'Guardando…' : 'Guardar' }}
            </button>
          </div>
        </form>
      }

      @if (loading()) {
        <nx-loading-state text="Cargando estaciones…" />
      } @else if (error()) {
        <nx-error-state title="No se pudieron cargar las estaciones" message="{{ error() }}" (retry)="load()" />
      } @else if (estaciones().length === 0) {
        <nx-empty-state icon="server" title="Sin estaciones virtuales"
          description="Cree una estación para asignarla a sus empleados digitales desde la pestaña «Ejecución» de cada agente."
          [actionLabel]="canManage() ? 'Nueva estación' : ''" actionIcon="plus" (action)="nueva()" />
      } @else {
        <div class="card table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Nombre</th><th>Proveedor</th><th>Estado</th><th class="num">Agentes</th>
                @if (canManage()) { <th class="num">Acciones</th> }
              </tr>
            </thead>
            <tbody>
              @for (e of estaciones(); track e.id) {
                <tr>
                  <td>
                    <strong>{{ e.nombre }}</strong>
                    @if (e.descripcion) { <span class="muted small block">{{ e.descripcion }}</span> }
                  </td>
                  <td>{{ e.proveedor || '—' }}</td>
                  <td><span class="badge {{ badgeClass(e.estado) }}">{{ estadoLabel(e.estado) }}</span></td>
                  <td class="num">{{ e.agentesCount ?? 0 }}</td>
                  @if (canManage()) {
                    <td class="num actions-cell">
                      <button class="btn ghost icon sm" title="Editar" aria-label="Editar estación {{ e.nombre }}" [disabled]="!!draft()" (click)="editar(e)">
                        <nx-icon name="pencil" [size]="15" />
                      </button>
                      @if (e.estado !== 'RETIRADA') {
                        <button class="btn ghost icon sm danger" title="Retirar" aria-label="Retirar estación {{ e.nombre }}"
                          [disabled]="retiring() === e.id" (click)="retirar(e)">
                          <nx-icon name="stop" [size]="15" />
                        </button>
                      }
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: `
    .editor { max-width: 640px; margin-bottom: 18px; }
    .m0 { margin: 0; }
    .spacer { flex: 1; }
    .table-wrap { padding: 0; overflow-x: auto; }
    .num { text-align: right; }
    .actions-cell { white-space: nowrap; }
    .actions-cell .btn { margin-left: 4px; }
  `,
})
export class EstacionesVirtualesPage implements OnInit {
  private readonly api = inject(ExecutionParamsApi);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  readonly estaciones = signal<EstacionVirtual[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly retiring = signal<string | null>(null);
  readonly draft = signal<Draft | null>(null);
  readonly touched = signal(false);

  readonly canManage = computed(() => puedeAdministrarEstaciones(this.auth.session()?.role));
  readonly estadoLabel = estadoEstacionLabel;
  readonly badgeClass = estadoEstacionBadgeClass;
  readonly nombreError = computed(() => (this.draft() ? validarNombreEstacion(this.draft()!.nombre) : null));

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.estaciones.set(await this.api.estaciones());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  /** Actualiza el borrador re-emitiendo el signal con una nueva referencia (para que los `computed` reaccionen). */
  patch(p: Partial<Draft>) {
    const d = this.draft();
    if (d) this.draft.set({ ...d, ...p });
  }

  nueva() {
    if (!this.canManage()) return;
    this.touched.set(false);
    this.draft.set({ ...EMPTY_DRAFT });
  }

  editar(e: EstacionVirtual) {
    if (!this.canManage()) return;
    this.touched.set(false);
    this.draft.set({ id: e.id, nombre: e.nombre, descripcion: e.descripcion ?? '', proveedor: e.proveedor ?? '' });
  }

  cancelar() {
    this.draft.set(null);
  }

  async guardar() {
    const d = this.draft();
    if (!d || this.saving()) return;
    this.touched.set(true);
    if (this.nombreError()) return;
    this.saving.set(true);
    try {
      const payload = {
        nombre: d.nombre.trim(),
        descripcion: d.descripcion.trim() || undefined,
        proveedor: d.proveedor.trim() || undefined,
      };
      if (d.id) {
        await this.api.actualizarEstacion(d.id, payload);
        this.toast.success('Estación actualizada');
      } else {
        await this.api.crearEstacion(payload);
        this.toast.success('Estación creada');
      }
      this.draft.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  async retirar(e: EstacionVirtual) {
    if (!this.canManage() || this.retiring()) return;
    if (!confirm(`¿Retirar la estación «${e.nombre}»? Pasará a RETIRADA; los agentes asignados conservan el vínculo histórico.`)) return;
    this.retiring.set(e.id);
    try {
      await this.api.retirarEstacion(e.id);
      this.toast.success('Estación retirada');
      await this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.retiring.set(null);
    }
  }
}
