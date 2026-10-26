import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CollaborationApi } from '../../core/collaboration.api';
import { ToastService } from '../../core/toast.service';
import type { Canal, HiloCanal, TipoCanal } from '../../core/collaboration.models';
import { TIPOS_CANAL } from '../../core/collaboration.models';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { PageHeaderComponent } from '../../layout/page-header.component';
import { corto, tipoCanalMeta } from './mensajes.util';

/**
 * Canales y hilos de coordinación transversal (RF36). Lista los canales por misión/proceso/área y los hilos del canal
 * seleccionado. Acción central: «convertir solicitud en tarea autorizada» — mencionar no asigna trabajo ni concede
 * acceso; la tarea nace solo con autoridad (EDITOR+) y queda enlazada al hilo. Diferencia visualmente al responsable
 * DIGITAL (agente) del dueño HUMANO (persona). Estados de carga, vacío y error; no inventa datos.
 */
@Component({
  selector: 'nx-canales',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  template: `
    <div class="page">
      <nx-page-header
        heading="Canales"
        description="Coordinación por misión, proceso o área. Una solicitud no ejecuta sola: se convierte en tarea autorizada solo con autoridad">
        @if (canEdit()) {
          <button actions class="btn primary" (click)="nuevoCanal.set(!nuevoCanal())">
            <nx-icon name="plus" [size]="15" />Nuevo canal
          </button>
        }
      </nx-page-header>

      @if (canEdit() && nuevoCanal()) {
        <form class="card compose" (ngSubmit)="crearCanal()">
          <div class="grid">
            <div class="field">
              <label for="n-tipo">Tipo</label>
              <select id="n-tipo" class="input" [(ngModel)]="nTipo" name="tipo">
                @for (t of tipos; track t) {
                  <option [value]="t">{{ tipoMeta(t).label }}</option>
                }
              </select>
            </div>
            <div class="field grow">
              <label for="n-nombre">Nombre</label>
              <input id="n-nombre" class="input" [(ngModel)]="nNombre" name="nombre" required />
            </div>
          </div>
          <div class="field">
            <label for="n-desc">Descripción (opcional)</label>
            <input id="n-desc" class="input" [(ngModel)]="nDesc" name="desc" />
          </div>
          <div class="acciones">
            <button type="submit" class="btn primary" [disabled]="busy() || !nNombre().trim()">Crear canal</button>
            <button type="button" class="btn ghost" (click)="nuevoCanal.set(false)">Cancelar</button>
          </div>
        </form>
      }

      @if (loading()) {
        <nx-loading-state text="Cargando los canales…" />
      } @else if (error()) {
        <nx-error-state message="{{ error() }}" (retry)="load()" />
      } @else if (!canales().length) {
        <nx-empty-state icon="branch" title="Sin canales"
          description="Crea un canal por misión, proceso o área para coordinar el trabajo transversal." />
      } @else {
        <div class="layout">
          <nav class="lista card" aria-label="Canales">
            <ul>
              @for (c of canales(); track c.id) {
                <li>
                  <button class="canal" [class.sel]="seleccion() === c.id" (click)="seleccionar(c.id)"
                    [attr.aria-current]="seleccion() === c.id ? 'true' : null">
                    <span class="badge {{ tipoMeta(c.tipo).badge }}"><nx-icon [name]="tipoMeta(c.tipo).icon" [size]="12" />{{ tipoMeta(c.tipo).label }}</span>
                    <span class="nombre">{{ c.nombre }}</span>
                    <span class="cuenta">{{ c._count?.hilos ?? 0 }}</span>
                  </button>
                </li>
              }
            </ul>
          </nav>

          <section class="detalle">
            @if (canalSel(); as c) {
              <div class="card">
                <header class="card-title">
                  <nx-icon [name]="tipoMeta(c.tipo).icon" [size]="18" />
                  <h2>{{ c.nombre }}</h2>
                  <span class="badge {{ tipoMeta(c.tipo).badge }}">{{ tipoMeta(c.tipo).label }}</span>
                </header>
                @if (c.descripcion) {
                  <p class="desc">{{ c.descripcion }}</p>
                }
                @if (canEdit()) {
                  <form class="mini" (ngSubmit)="crearHilo()">
                    <div class="field grow">
                      <label for="h-asunto">Nuevo hilo</label>
                      <input id="h-asunto" class="input" [(ngModel)]="hAsunto" name="asunto" placeholder="Asunto del hilo" />
                    </div>
                    <button type="submit" class="btn" [disabled]="busy() || !hAsunto().trim()">
                      <nx-icon name="plus" [size]="15" />Abrir hilo
                    </button>
                  </form>
                }
              </div>

              @if (hilosLoading()) {
                <nx-loading-state text="Cargando los hilos…" size="sm" />
              } @else if (!hilos().length) {
                <nx-empty-state icon="inbox" title="Sin hilos"
                  description="Abre un hilo para registrar una solicitud o coordinación en este canal." />
              } @else {
                <ul class="hilos">
                  @for (h of hilos(); track h.id) {
                    <li class="card">
                      <div class="hilo-top">
                        <span class="asunto">{{ h.asunto }}</span>
                        @if (h.tareaId) {
                          <span class="badge success" title="Ya convertido en tarea autorizada">
                            <nx-icon name="checkCircle" [size]="12" />Tarea creada
                          </span>
                        } @else {
                          <span class="badge" title="Solicitud sin autorizar">Solicitud</span>
                        }
                      </div>
                      <div class="hilo-meta">
                        <span><nx-icon name="shuffle" [size]="12" />{{ h.intercambios }} intercambio(s)</span>
                        <span><nx-icon name="clock" [size]="12" />{{ h.createdAt | ago }}</span>
                        @if (h.tareaId) {
                          <a [routerLink]="['/trabajo/tareas', h.tareaId]"><nx-icon name="list" [size]="12" />Ver tarea</a>
                        }
                      </div>
                      @if (canEdit()) {
                        <div class="hilo-acc">
                          <button class="btn sm" [disabled]="accionBusy() === h.id" (click)="intercambio(h)"
                            title="Registrar un intercambio (prevención de ruido/ciclos)">
                            <nx-icon name="shuffle" [size]="13" />Intercambio
                          </button>
                          @if (!h.tareaId) {
                            <button class="btn sm primary" [disabled]="accionBusy() === h.id" (click)="convertirAbrir(h)">
                              <nx-icon name="list" [size]="13" />Convertir en tarea
                            </button>
                          }
                        </div>
                        @if (convertirTarget() === h.id) {
                          <form class="mini col" (ngSubmit)="convertir(h)">
                            <div class="field">
                              <label for="cv-titulo-{{ h.id }}">Título de la tarea autorizada</label>
                              <input id="cv-titulo-{{ h.id }}" class="input" [(ngModel)]="cvTitulo" name="titulo" required />
                            </div>
                            <div class="field">
                              <label for="cv-crit-{{ h.id }}">Criterio de aceptación (opcional)</label>
                              <input id="cv-crit-{{ h.id }}" class="input" [(ngModel)]="cvCriterio" name="crit" />
                            </div>
                            <div class="grid">
                              <div class="field">
                                <label for="cv-resp-{{ h.id }}"><nx-icon name="bot" [size]="12" />Responsable digital (agente)</label>
                                <input id="cv-resp-{{ h.id }}" class="input" [(ngModel)]="cvResponsable" name="resp" placeholder="ID de agente" />
                              </div>
                              <div class="field">
                                <label for="cv-dueno-{{ h.id }}"><nx-icon name="user" [size]="12" />Dueño humano (persona)</label>
                                <input id="cv-dueno-{{ h.id }}" class="input" [(ngModel)]="cvDueno" name="dueno" placeholder="ID de usuario" />
                              </div>
                            </div>
                            <p class="hint" role="note">Mencionar no asigna trabajo: la tarea se crea con tu autoridad (QA12).</p>
                            <div class="acciones">
                              <button type="submit" class="btn sm primary" [disabled]="!cvTitulo().trim()">Crear tarea</button>
                              <button type="button" class="btn sm ghost" (click)="convertirTarget.set(null)">Cancelar</button>
                            </div>
                          </form>
                        }
                      }
                    </li>
                  }
                </ul>
              }
            } @else {
              <nx-empty-state icon="branch" title="Elige un canal" description="Selecciona un canal para ver sus hilos." />
            }
          </section>
        </div>
      }
    </div>
  `,
  styles: `
    .compose { display: flex; flex-direction: column; gap: 12px; margin-bottom: 18px; }
    .compose .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .field.grow { flex: 1; }
    .layout { display: grid; grid-template-columns: 280px 1fr; gap: 18px; align-items: start; }
    .lista { padding: 8px; }
    .lista ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .canal { width: 100%; display: flex; align-items: center; gap: 8px; padding: 9px 10px; border: 0; background: transparent; border-radius: 9px; cursor: pointer; text-align: left; color: var(--text); }
    .canal:hover { background: var(--surface-2); }
    .canal.sel { background: var(--primary-50); }
    .canal .nombre { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; font-size: 13.5px; }
    .canal .cuenta { font-size: 12px; color: var(--muted); }
    .detalle { display: flex; flex-direction: column; gap: 14px; }
    .card-title { flex-wrap: wrap; }
    .card-title h2 { font-size: 16px; margin: 0; flex: 1; }
    .desc { margin: 0 0 8px; font-size: 13.5px; }
    .hilos { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
    .hilos > li { display: flex; flex-direction: column; gap: 7px; }
    .hilo-top { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .hilo-top .asunto { flex: 1; min-width: 0; font-weight: 650; font-size: 14px; }
    .hilo-meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--muted); }
    .hilo-meta span, .hilo-meta a { display: inline-flex; align-items: center; gap: 4px; }
    .hilo-meta a { color: var(--primary); }
    .hilo-acc { display: flex; flex-wrap: wrap; gap: 8px; }
    .mini { display: flex; gap: 10px; align-items: flex-end; }
    .mini.col { flex-direction: column; align-items: stretch; background: var(--surface-2); padding: 12px; border-radius: 10px; }
    .mini .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .mini label nx-icon { vertical-align: -2px; margin-right: 3px; }
    .hint { margin: 0; font-size: 12px; color: var(--muted); }
    .acciones { display: flex; flex-wrap: wrap; gap: 8px; }
    @media (max-width: 760px) { .layout { grid-template-columns: 1fr; } .mini { flex-direction: column; align-items: stretch; } .mini .grid { grid-template-columns: 1fr; } }
  `,
})
export class CanalesPage implements OnInit {
  private readonly api = inject(CollaborationApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly tipos = TIPOS_CANAL;
  protected readonly corto = corto;
  protected readonly tipoMeta = tipoCanalMeta;

  protected readonly canales = signal<Canal[]>([]);
  protected readonly hilos = signal<HiloCanal[]>([]);
  protected readonly seleccion = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly hilosLoading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly accionBusy = signal<string | null>(null);

  protected readonly canEdit = computed(() => this.auth.canEdit());
  protected readonly canalSel = computed(() => this.canales().find((c) => c.id === this.seleccion()) ?? null);

  protected readonly nuevoCanal = signal(false);
  protected readonly nTipo = signal<TipoCanal>('MISION');
  protected readonly nNombre = signal('');
  protected readonly nDesc = signal('');
  protected readonly hAsunto = signal('');

  protected readonly convertirTarget = signal<string | null>(null);
  protected readonly cvTitulo = signal('');
  protected readonly cvCriterio = signal('');
  protected readonly cvResponsable = signal('');
  protected readonly cvDueno = signal('');

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const canales = await this.api.canales();
      this.canales.set(canales);
      if (canales.length && !this.seleccion()) this.seleccionar(canales[0].id);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected seleccionar(id: string) {
    this.seleccion.set(id);
    this.convertirTarget.set(null);
    void this.cargarHilos(id);
  }

  private async cargarHilos(canalId: string) {
    this.hilosLoading.set(true);
    try {
      this.hilos.set(await this.api.hilos(canalId));
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.hilosLoading.set(false);
    }
  }

  protected crearCanal() {
    const nombre = this.nNombre().trim();
    if (!nombre) return;
    this.busy.set(true);
    this.api
      .crearCanal({ tipo: this.nTipo(), nombre, descripcion: this.nDesc().trim() || undefined })
      .then((c) => {
        this.toast.success('Canal creado');
        this.nuevoCanal.set(false);
        this.nNombre.set('');
        this.nDesc.set('');
        return this.load().then(() => this.seleccionar(c.id));
      })
      .catch((e) => this.toast.error(errorMessage(e)))
      .finally(() => this.busy.set(false));
  }

  protected crearHilo() {
    const canalId = this.seleccion();
    const asunto = this.hAsunto().trim();
    if (!canalId || !asunto) return;
    this.busy.set(true);
    this.api
      .crearHilo(canalId, { asunto })
      .then(() => {
        this.toast.success('Hilo abierto');
        this.hAsunto.set('');
        return Promise.all([this.load(), this.cargarHilos(canalId)]);
      })
      .catch((e) => this.toast.error(errorMessage(e)))
      .finally(() => this.busy.set(false));
  }

  protected intercambio(h: HiloCanal) {
    this.accionBusy.set(h.id);
    this.api
      .registrarIntercambio(h.id)
      .then(() => this.cargarHilos(h.canalId))
      .catch((e) => this.toast.error(errorMessage(e)))
      .finally(() => this.accionBusy.set(null));
  }

  protected convertirAbrir(h: HiloCanal) {
    this.cvTitulo.set(h.asunto);
    this.cvCriterio.set('');
    this.cvResponsable.set('');
    this.cvDueno.set('');
    this.convertirTarget.set(h.id);
  }

  protected convertir(h: HiloCanal) {
    const titulo = this.cvTitulo().trim();
    if (!titulo) return;
    this.accionBusy.set(h.id);
    this.api
      .convertirEnTarea(h.id, {
        titulo,
        criterioAceptacion: this.cvCriterio().trim() || undefined,
        responsableAgentId: this.cvResponsable().trim() || undefined,
        duenoUserId: this.cvDueno().trim() || undefined,
      })
      .then(() => {
        this.toast.success('Solicitud convertida en tarea autorizada');
        this.convertirTarget.set(null);
        return this.cargarHilos(h.canalId);
      })
      .catch((e) => this.toast.error(errorMessage(e)))
      .finally(() => this.accionBusy.set(null));
  }
}
