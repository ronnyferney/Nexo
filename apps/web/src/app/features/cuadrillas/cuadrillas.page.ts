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
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CrewsApi } from '../../core/crews.api';
import {
  CREW_ESTADO_BADGE,
  CREW_ESTADO_LABELS,
  CREW_ESTADOS,
  type CreateCrewInput,
  type CrewEstado,
  type CrewSummary,
} from '../../core/crews.models';
import { ToastService } from '../../core/toast.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { PageHeaderComponent } from '../../layout/page-header.component';

/** Borrador del formulario de nueva plantilla. */
interface CrewDraft {
  nombre: string;
  proposito: string;
  procesoObjetivo: string;
}

/**
 * Catálogo de Cuadrillas (ADR 0014 · D1 · E11): plantillas de equipo de empleados digitales gobernadas, versionadas y
 * 100 % declarativas. Lectura para cualquier miembro; crear una plantilla en BORRADOR requiere ADMIN. Una Cuadrilla es
 * configuración, no código: instanciarla no ejecuta nada ni concede acceso a datos.
 */
@Component({
  selector: 'nx-cuadrillas',
  imports: [
    FormsModule,
    RouterLink,
    IconComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    LoadingStateComponent,
    RelativeTimePipe,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nx-page-header
        heading="Cuadrillas"
        description="Plantillas de equipo de empleados digitales: gobernadas, versionadas y 100 % declarativas. Instanciar una Cuadrilla no ejecuta código ni concede acceso a datos."
      >
        <div actions>
          @if (isAdmin()) {
            <button class="btn primary brand" (click)="openCreate()">
              <nx-icon name="plus" />Nueva Cuadrilla
            </button>
          }
        </div>
      </nx-page-header>

      <div class="filters" role="group" aria-label="Filtrar por estado">
        <button class="chip" [class.active]="estado() === null" (click)="setEstado(null)">Todas</button>
        @for (e of estados; track e) {
          <button class="chip" [class.active]="estado() === e" (click)="setEstado(e)">{{ estadoLabels[e] }}</button>
        }
      </div>

      @if (error()) {
        <nx-error-state message="{{ error() }}" title="No se pudieron cargar las Cuadrillas" (retry)="load()" />
      } @else if (loading()) {
        <nx-loading-state text="Cargando el catálogo de Cuadrillas…" />
      } @else if (!crews().length) {
        <nx-empty-state
          icon="users"
          title="Sin Cuadrillas"
          [description]="emptyDescription()"
          [actionLabel]="isAdmin() && !estado() ? 'Nueva Cuadrilla' : ''"
          actionIcon="plus"
          (action)="openCreate()"
        />
      } @else {
        <div class="crews">
          @for (c of crews(); track c.id) {
            <a class="card crew-card" [routerLink]="['/cuadrillas', c.id]">
              <div class="c-head">
                <div class="icon-tile"><nx-icon name="users" /></div>
                <div class="grow">
                  <div class="title-row">
                    <h2>{{ c.nombre }}</h2>
                    <span class="badge {{ estadoBadge[c.estado] }}">{{ estadoLabels[c.estado] }}</span>
                  </div>
                  @if (c.proposito) {
                    <p class="muted small m0">{{ c.proposito }}</p>
                  } @else {
                    <p class="muted small m0 italic">Sin propósito definido</p>
                  }
                </div>
              </div>
              <dl class="facets">
                <div>
                  <dt><nx-icon name="layers" [size]="13" />Versiones</dt>
                  <dd>{{ c.versionesCount }}</dd>
                </div>
                <div>
                  <dt><nx-icon name="rocket" [size]="13" />Instancias</dt>
                  <dd>{{ c.instanciasCount }}</dd>
                </div>
              </dl>
              <div class="c-foot muted small">
                <span><nx-icon name="clock" [size]="12" />Actualizada {{ c.updatedAt | ago }}</span>
              </div>
            </a>
          }
        </div>
      }
    </div>

    @if (draft(); as d) {
      <dialog #dlg class="modal" aria-labelledby="crew-title" (cancel)="onCancel($event)" (close)="draft.set(null)">
        <form (ngSubmit)="create()">
          <div class="modal-head">
            <div class="icon-tile"><nx-icon name="users" /></div>
            <div class="grow">
              <h2 id="crew-title">Nueva Cuadrilla</h2>
              <span class="small muted"
                >Crea la plantilla en BORRADOR. Definirás sus miembros (cargos, skills, conectores sugeridos) en la
                siguiente pantalla. Es configuración declarativa: nunca código, hooks ni URLs de arranque.</span
              >
            </div>
          </div>
          <div class="modal-body">
            <div class="field">
              <label for="crew-nombre"
                >Nombre <abbr class="req" title="Obligatorio" aria-hidden="true">*</abbr></label
              >
              <input
                id="crew-nombre"
                class="input"
                required
                minlength="2"
                maxlength="120"
                [ngModel]="d.nombre"
                (ngModelChange)="patch({ nombre: $event })"
                name="nombre"
                placeholder="p. ej. Equipo de soporte de primer nivel"
              />
            </div>
            <div class="field">
              <label for="crew-proposito">Propósito</label>
              <textarea
                id="crew-proposito"
                class="input"
                rows="2"
                maxlength="2000"
                [ngModel]="d.proposito"
                (ngModelChange)="patch({ proposito: $event })"
                name="proposito"
                placeholder="La misión del equipo en una o dos frases"
              ></textarea>
            </div>
            <div class="field">
              <label for="crew-proceso">Proceso objetivo</label>
              <textarea
                id="crew-proceso"
                class="input"
                rows="2"
                maxlength="2000"
                [ngModel]="d.procesoObjetivo"
                (ngModelChange)="patch({ procesoObjetivo: $event })"
                name="procesoObjetivo"
                placeholder="El proceso de negocio que esta Cuadrilla dota"
              ></textarea>
            </div>
            @if (formError()) {
              <div class="callout danger" role="alert">
                <nx-icon name="alert" [size]="16" /><span>{{ formError() }}</span>
              </div>
            }
          </div>
          <div class="modal-foot">
            <button type="button" class="btn" (click)="close()">Cancelar</button>
            <button type="submit" class="btn primary" [disabled]="busy() || d.nombre.trim().length < 2">
              <nx-icon name="save" [size]="16" />{{ busy() ? 'Creando…' : 'Crear Cuadrilla' }}
            </button>
          </div>
        </form>
      </dialog>
    }
  `,
  styles: `
    .filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .chip { padding: 6px 14px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--muted); font: inherit; font-size: 13px; cursor: pointer; }
    .chip:hover { border-color: var(--primary); color: var(--text); }
    .chip.active { background: var(--primary); border-color: var(--primary); color: #fff; font-weight: 600; }
    .crews { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); align-items: start; }
    .crew-card { display: flex; flex-direction: column; gap: 12px; text-decoration: none; color: inherit; }
    .crew-card:hover { border-color: var(--primary); }
    .c-head { display: flex; gap: 12px; align-items: flex-start; }
    .grow { flex: 1; min-width: 0; }
    .title-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 4px; }
    .title-row h2 { margin: 0; font-size: 16px; overflow-wrap: anywhere; }
    .m0 { margin: 0; }
    .italic { font-style: italic; }
    .facets { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 8px; margin: 0; }
    .facets div { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 9px; }
    .facets dt { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--muted); font-weight: 600; }
    .facets dt nx-icon { color: var(--muted); }
    .facets dd { margin: 0; font-size: 18px; font-weight: 700; }
    .c-foot { display: flex; gap: 12px; }
    .c-foot span { display: inline-flex; align-items: center; gap: 4px; }
    .modal-body { display: flex; flex-direction: column; gap: 14px; }
    @media (max-width: 560px) { .crews { grid-template-columns: 1fr; } }
  `,
})
export class CuadrillasPage implements OnInit {
  private readonly api = inject(CrewsApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  readonly estados = CREW_ESTADOS;
  readonly estadoLabels = CREW_ESTADO_LABELS;
  readonly estadoBadge = CREW_ESTADO_BADGE;
  readonly isAdmin = this.auth.isAdmin;

  readonly crews = signal<CrewSummary[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly estado = signal<CrewEstado | null>(null);

  readonly draft = signal<CrewDraft | null>(null);
  readonly busy = signal(false);
  readonly formError = signal<string | null>(null);

  readonly emptyDescription = computed(() =>
    this.estado()
      ? `No hay Cuadrillas en estado «${this.estadoLabels[this.estado()!]}».`
      : 'Aún no hay Cuadrillas en el catálogo. Defina una plantilla de equipo reutilizable para sus empleados digitales.',
  );

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.crews.set(await this.api.list(this.estado() ?? undefined));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  setEstado(e: CrewEstado | null) {
    if (this.estado() === e) return;
    this.estado.set(e);
    void this.load();
  }

  openCreate() {
    if (!this.isAdmin()) return;
    this.formError.set(null);
    this.draft.set({ nombre: '', proposito: '', procesoObjetivo: '' });
    afterNextRender(() => this.dialog()?.nativeElement.showModal(), { injector: this.injector });
  }

  patch(part: Partial<CrewDraft>) {
    this.draft.update((d) => (d ? { ...d, ...part } : d));
  }

  close() {
    if (!this.busy()) this.dialog()?.nativeElement.close();
  }

  onCancel(ev: Event) {
    if (this.busy()) ev.preventDefault();
  }

  async create() {
    const d = this.draft();
    if (!d || this.busy() || d.nombre.trim().length < 2) return;
    this.busy.set(true);
    this.formError.set(null);
    const payload: CreateCrewInput = {
      nombre: d.nombre.trim(),
      proposito: d.proposito.trim() || undefined,
      procesoObjetivo: d.procesoObjetivo.trim() || undefined,
    };
    try {
      const created = await this.api.create(payload);
      this.busy.set(false);
      this.dialog()?.nativeElement.close();
      this.toast.success(`Cuadrilla «${created.nombre}» creada en borrador`);
      void this.router.navigate(['/cuadrillas', created.id]);
    } catch (e) {
      this.formError.set(errorMessage(e));
      this.busy.set(false);
    }
  }
}
