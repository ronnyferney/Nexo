import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CommunityApi } from '../../core/community.api';
import { ResultsApi } from '../../core/results.api';
import { ToastService } from '../../core/toast.service';
import type {
  Publicacion,
  PublicacionDetalle,
  PublicacionEstado,
  PublicacionTipo,
  ReaccionTipo,
} from '../../core/community.models';
import { ESTADOS_PUBLICACION, TIPOS_PUBLICACION, TIPOS_REACCION } from '../../core/community.models';
import type { OrgUnitOption } from '../../core/models';
import type { Tarea } from '../../core/results.models';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { PageHeaderComponent } from '../../layout/page-header.component';
import {
  corto,
  estadoPublicacionMeta,
  formatearConteo,
  permiteTarea,
  puedeArchivar,
  puedeResolver,
  reaccionMeta,
  tipoPublicacionMeta,
} from './comunidad.util';

const TAKE = 20;

/**
 * Muro de comunidad interna (E11): el feed corporativo privado. Publicar, comentar y reaccionar es participación
 * normal (VIEWER+): el muro no se oculta a nadie. Las acciones del autor/ADMIN (marcar un APOYO como RESUELTO,
 * archivar, editar) se ofrecen solo a quien corresponde (`comunidad.util`), pero el servidor es el gate real. El
 * cuerpo es texto de usuario: se muestra como texto plano, nunca como HTML. Estados de carga, vacío y error; no
 * inventa datos. Como la API no expone qué reacciones dio el usuario, el estado «reaccionado» es local a la sesión.
 */
@Component({
  selector: 'nx-comunidad',
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
        heading="Comunidad"
        description="El muro interno del equipo: comparte novedades, pide apoyo, cuenta aprendizajes y declara compromisos.">
        <button actions class="btn primary" (click)="alternarComponer()" [attr.aria-expanded]="componiendo()">
          <nx-icon name="plus" [size]="15" />Nueva publicación
        </button>
      </nx-page-header>

      @if (componiendo()) {
        <form class="card compose" (ngSubmit)="crear()">
          <div class="grid">
            <div class="field">
              <label for="c-tipo">Tipo</label>
              <select id="c-tipo" class="input" [(ngModel)]="cTipo" name="tipo">
                @for (t of tipos; track t) {
                  <option [value]="t">{{ meta(t).label }}</option>
                }
              </select>
            </div>
            <div class="field grow">
              <label for="c-titulo">Título (opcional)</label>
              <input id="c-titulo" class="input" [(ngModel)]="cTitulo" name="titulo" maxlength="200"
                placeholder="Un titular breve" />
            </div>
          </div>
          <p class="hint">{{ meta(cTipo()).descripcion }}</p>
          <div class="field">
            <label for="c-cuerpo">Mensaje</label>
            <textarea id="c-cuerpo" class="input" [(ngModel)]="cCuerpo" name="cuerpo" rows="4" maxlength="10000"
              required placeholder="Escribe tu publicación para el equipo…"></textarea>
          </div>
          @if (permiteTarea(cTipo())) {
            <div class="field">
              <label for="c-tarea">Tarea vinculada (opcional)</label>
              @if (tareas().length) {
                <select id="c-tarea" class="input" [(ngModel)]="cTareaId" name="tarea">
                  <option value="">— Sin tarea —</option>
                  @for (t of tareas(); track t.id) {
                    <option [value]="t.id">{{ t.titulo }}</option>
                  }
                </select>
              } @else {
                <input id="c-tarea" class="input" [(ngModel)]="cTareaId" name="tarea"
                  placeholder="ID de una tarea del workspace" />
              }
              <span class="hint">Solo un compromiso o un pedido de apoyo puede ligarse a una tarea.</span>
            </div>
          }
          <div class="acciones">
            <button type="submit" class="btn primary" [disabled]="busy() || !cCuerpo().trim()">Publicar</button>
            <button type="button" class="btn ghost" (click)="componiendo.set(false)">Cancelar</button>
          </div>
        </form>
      }

      <div class="card filtros" role="group" aria-label="Filtros del muro">
        <div class="field">
          <label for="f-tipo">Tipo</label>
          <select id="f-tipo" class="input" [ngModel]="fTipo()" (ngModelChange)="fTipo.set($event); recargar()" name="fTipo">
            <option value="">Todos</option>
            @for (t of tipos; track t) {
              <option [value]="t">{{ meta(t).label }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="f-estado">Estado</label>
          <select id="f-estado" class="input" [ngModel]="fEstado()" (ngModelChange)="fEstado.set($event); recargar()" name="fEstado">
            <option value="">Vigentes</option>
            @for (e of estados; track e) {
              <option [value]="e">{{ estadoMeta(e).label }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="f-area">Área</label>
          <select id="f-area" class="input" [ngModel]="fOrgUnit()" (ngModelChange)="fOrgUnit.set($event); recargar()" name="fArea">
            <option value="">Todas</option>
            @for (u of orgUnits(); track u.id) {
              <option [value]="u.id">{{ u.name }}</option>
            }
          </select>
        </div>
      </div>

      @if (loading()) {
        <nx-loading-state text="Cargando el muro…" />
      } @else if (error()) {
        <nx-error-state message="{{ error() }}" (retry)="recargar()" />
      } @else if (!feed().length) {
        <nx-empty-state icon="send" title="Aún no hay publicaciones"
          description="Sé el primero en compartir una novedad, un aprendizaje o un compromiso con el equipo."
          actionLabel="Nueva publicación" actionIcon="plus" (action)="alternarComponer()" />
      } @else {
        <ul class="feed">
          @for (p of feed(); track p.id) {
            <li class="card pub">
              <header class="pub-top">
                <span class="badge {{ meta(p.tipo).badge }}" [title]="meta(p.tipo).descripcion">
                  <nx-icon [name]="meta(p.tipo).icon" [size]="13" />{{ meta(p.tipo).label }}
                </span>
                @if (p.estado !== 'ACTIVA') {
                  <span class="badge {{ estadoMeta(p.estado).badge }}">{{ estadoMeta(p.estado).label }}</span>
                }
                <span class="autor" title="Autor (referencia)"><nx-icon name="user" [size]="12" />{{ corto(p.autorUserId) }}</span>
                <span class="fecha"><nx-icon name="clock" [size]="12" />{{ p.createdAt | ago }}</span>
              </header>

              @if (p.titulo) {
                <h2 class="pub-titulo">{{ p.titulo }}</h2>
              }
              <p class="pub-cuerpo">{{ p.cuerpo }}</p>

              @if (p.tareaId) {
                <a class="tarea-link" [routerLink]="['/trabajo/tareas', p.tareaId]">
                  <nx-icon name="list" [size]="13" />Tarea vinculada {{ corto(p.tareaId) }}
                </a>
              }

              <footer class="pub-foot">
                <button class="btn sm ghost" (click)="alternarDetalle(p.id)"
                  [attr.aria-expanded]="expandido() === p.id" [attr.aria-controls]="'detalle-' + p.id">
                  <nx-icon name="inbox" [size]="13" />{{ conteo(p._count?.comentarios) }} comentario(s)
                </button>
                <span class="reac-total"><nx-icon name="thumbsUp" [size]="13" />{{ conteo(p._count?.reacciones) }} reacción(es)</span>

                @if (puedeResolver(p, userId(), isAdmin())) {
                  <button class="btn sm" [disabled]="accionBusy() === p.id" (click)="resolver(p)"
                    title="Marcar este apoyo/compromiso como resuelto">
                    <nx-icon name="checkCircle" [size]="13" />Marcar resuelto
                  </button>
                }
                @if (puedeArchivar(p, userId(), isAdmin())) {
                  <button class="btn sm danger" [disabled]="accionBusy() === p.id" (click)="archivar(p)"
                    title="Archivar (baja lógica: sale del muro)">
                    <nx-icon name="trash" [size]="13" />Archivar
                  </button>
                }
              </footer>

              @if (expandido() === p.id) {
                <section class="detalle" [id]="'detalle-' + p.id">
                  <div class="reacciones" role="group" aria-label="Reacciones">
                    @for (r of reacciones; track r) {
                      <button type="button" class="btn sm react" [class.on]="haReaccionado(p.id, r)"
                        [attr.aria-pressed]="haReaccionado(p.id, r)" [disabled]="reaccionBusy() === p.id + ':' + r"
                        (click)="alternarReaccion(p, r)" [title]="reaccionMeta(r).label">
                        <nx-icon [name]="reaccionMeta(r).icon" [size]="14" />{{ reaccionMeta(r).label }}
                      </button>
                    }
                  </div>

                  @if (detalleLoading()) {
                    <nx-loading-state text="Cargando comentarios…" size="sm" />
                  } @else if (detalle(); as d) {
                    @if (!d.comentarios.length) {
                      <p class="vacio-com">Sé el primero en comentar.</p>
                    } @else {
                      <ul class="comentarios">
                        @for (c of d.comentarios; track c.id) {
                          <li>
                            <div class="com-top">
                              <span class="autor"><nx-icon name="user" [size]="12" />{{ corto(c.autorUserId) }}</span>
                              <span class="fecha">{{ c.createdAt | ago }}</span>
                            </div>
                            <p class="com-cuerpo">{{ c.cuerpo }}</p>
                          </li>
                        }
                      </ul>
                    }

                    <form class="mini" (ngSubmit)="comentar(p)">
                      <label class="sr-only" [attr.for]="'com-' + p.id">Nuevo comentario</label>
                      <input [id]="'com-' + p.id" class="input" [(ngModel)]="nuevoComentario" name="comentario"
                        maxlength="5000" placeholder="Escribe un comentario…" />
                      <button type="submit" class="btn sm primary" [disabled]="busy() || !nuevoComentario().trim()">
                        <nx-icon name="send" [size]="13" />Comentar
                      </button>
                    </form>
                  }
                </section>
              }
            </li>
          }
        </ul>

        @if (hayMas()) {
          <div class="mas">
            <button class="btn" [disabled]="loadingMore()" (click)="cargarMas()">
              @if (loadingMore()) {
                <span class="spinner sm" aria-hidden="true"></span>Cargando…
              } @else {
                <nx-icon name="chevronDown" [size]="15" />Cargar más
              }
            </button>
            <span class="total">{{ feed().length }} de {{ total() }}</span>
          </div>
        }
      }
    </div>
  `,
  styles: `
    .compose { display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; }
    .compose .grid { display: grid; grid-template-columns: 200px 1fr; gap: 12px; }
    .field.grow { flex: 1; }
    .hint { margin: 0; font-size: 12px; color: var(--muted); }
    .acciones { display: flex; flex-wrap: wrap; gap: 8px; }
    .filtros { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 18px; padding: 14px 16px; }
    .filtros .field { min-width: 150px; flex: 1; }
    .feed { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
    .pub { display: flex; flex-direction: column; gap: 8px; }
    .pub-top { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .pub-top .autor, .pub-top .fecha { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); }
    .pub-top .fecha { margin-left: auto; }
    .pub-titulo { margin: 2px 0 0; font-size: 16px; }
    .pub-cuerpo { margin: 0; font-size: 14px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
    .tarea-link { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--primary); width: fit-content; }
    .pub-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 4px; }
    .pub-foot .reac-total { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; color: var(--muted); }
    .detalle { margin-top: 8px; padding-top: 12px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 12px; }
    .reacciones { display: flex; flex-wrap: wrap; gap: 8px; }
    .btn.react.on { border-color: var(--primary); color: var(--primary); background: var(--primary-50); }
    .vacio-com { margin: 0; font-size: 13px; color: var(--muted); }
    .comentarios { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .comentarios > li { background: var(--surface-2); border-radius: 10px; padding: 10px 12px; }
    .com-top { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
    .com-top .autor { display: inline-flex; align-items: center; gap: 4px; }
    .com-cuerpo { margin: 0; font-size: 13.5px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
    .mini { display: flex; gap: 8px; align-items: center; }
    .mini .input { flex: 1; }
    .mas { display: flex; align-items: center; gap: 12px; justify-content: center; margin-top: 18px; }
    .mas .total { font-size: 12.5px; color: var(--muted); }
    @media (max-width: 560px) {
      .compose .grid { grid-template-columns: 1fr; }
      .pub-top .fecha { margin-left: 0; }
    }
  `,
})
export class ComunidadPage implements OnInit {
  private readonly api = inject(CommunityApi);
  private readonly core = inject(ApiService);
  private readonly results = inject(ResultsApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly tipos = TIPOS_PUBLICACION;
  protected readonly estados = ESTADOS_PUBLICACION;
  protected readonly reacciones = TIPOS_REACCION;
  protected readonly meta = tipoPublicacionMeta;
  protected readonly estadoMeta = estadoPublicacionMeta;
  protected readonly reaccionMeta = reaccionMeta;
  protected readonly permiteTarea = permiteTarea;
  protected readonly puedeResolver = puedeResolver;
  protected readonly puedeArchivar = puedeArchivar;
  protected readonly corto = corto;
  protected readonly conteo = formatearConteo;

  protected readonly userId = computed(() => this.auth.me()?.id ?? null);
  protected readonly isAdmin = computed(() => this.auth.isAdmin());

  protected readonly feed = signal<Publicacion[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly accionBusy = signal<string | null>(null);
  protected readonly reaccionBusy = signal<string | null>(null);

  protected readonly orgUnits = signal<OrgUnitOption[]>([]);
  protected readonly tareas = signal<Tarea[]>([]);

  protected readonly fTipo = signal<PublicacionTipo | ''>('');
  protected readonly fEstado = signal<PublicacionEstado | ''>('');
  protected readonly fOrgUnit = signal('');

  protected readonly componiendo = signal(false);
  protected readonly cTipo = signal<PublicacionTipo>('NOVEDAD');
  protected readonly cTitulo = signal('');
  protected readonly cCuerpo = signal('');
  protected readonly cTareaId = signal('');

  protected readonly expandido = signal<string | null>(null);
  protected readonly detalle = signal<PublicacionDetalle | null>(null);
  protected readonly detalleLoading = signal(false);
  protected readonly nuevoComentario = signal('');

  /** Reacciones que el usuario ha dado en ESTA sesión (`${pubId}:${tipo}`): la API no las expone. */
  protected readonly reaccionadas = signal<ReadonlySet<string>>(new Set());

  protected readonly hayMas = computed(() => this.feed().length < this.total());

  ngOnInit() {
    void this.cargarCatalogos();
    void this.recargar();
  }

  private async cargarCatalogos() {
    try {
      this.orgUnits.set(await this.core.orgUnits());
    } catch {
      // El selector de área es auxiliar: si falla, el muro sigue funcionando sin ese filtro.
    }
  }

  protected async recargar() {
    this.loading.set(true);
    this.error.set(null);
    this.expandido.set(null);
    try {
      const res = await this.api.publicaciones(this.filtro(0));
      this.feed.set(res.items);
      this.total.set(res.total);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected async cargarMas() {
    if (this.loadingMore()) return;
    this.loadingMore.set(true);
    try {
      const res = await this.api.publicaciones(this.filtro(this.feed().length));
      this.feed.update((lista) => [...lista, ...res.items]);
      this.total.set(res.total);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.loadingMore.set(false);
    }
  }

  private filtro(skip: number) {
    return {
      tipo: this.fTipo() || undefined,
      estado: this.fEstado() || undefined,
      orgUnitId: this.fOrgUnit() || undefined,
      take: TAKE,
      skip,
    };
  }

  protected alternarComponer() {
    const abrir = !this.componiendo();
    this.componiendo.set(abrir);
    if (abrir && !this.tareas().length) void this.cargarTareas();
  }

  private async cargarTareas() {
    try {
      this.tareas.set(await this.results.tareas());
    } catch {
      // Sin catálogo de tareas, el formulario cae a un input de id (referencia blanda).
    }
  }

  protected crear() {
    const cuerpo = this.cCuerpo().trim();
    if (!cuerpo) return;
    const tipo = this.cTipo();
    this.busy.set(true);
    this.api
      .crearPublicacion({
        tipo,
        titulo: this.cTitulo().trim() || undefined,
        cuerpo,
        tareaId: permiteTarea(tipo) ? this.cTareaId().trim() || undefined : undefined,
      })
      .then(() => {
        this.toast.success('Publicación creada');
        this.componiendo.set(false);
        this.cTitulo.set('');
        this.cCuerpo.set('');
        this.cTareaId.set('');
        return this.recargar();
      })
      .catch((e) => this.toast.error(errorMessage(e)))
      .finally(() => this.busy.set(false));
  }

  protected alternarDetalle(id: string) {
    if (this.expandido() === id) {
      this.expandido.set(null);
      return;
    }
    this.expandido.set(id);
    this.detalle.set(null);
    this.nuevoComentario.set('');
    void this.cargarDetalle(id);
  }

  private async cargarDetalle(id: string) {
    this.detalleLoading.set(true);
    try {
      const d = await this.api.publicacion(id);
      this.detalle.set(d);
      this.sincronizarConteo(d);
    } catch (e) {
      this.toast.error(errorMessage(e));
      this.expandido.set(null);
    } finally {
      this.detalleLoading.set(false);
    }
  }

  /** Refleja en la tarjeta del feed los conteos frescos del detalle. */
  private sincronizarConteo(d: PublicacionDetalle) {
    this.feed.update((lista) => lista.map((p) => (p.id === d.id ? { ...p, _count: d._count, estado: d.estado } : p)));
  }

  protected comentar(p: Publicacion) {
    const cuerpo = this.nuevoComentario().trim();
    if (!cuerpo) return;
    this.busy.set(true);
    this.api
      .comentar(p.id, { cuerpo })
      .then(() => {
        this.nuevoComentario.set('');
        return this.cargarDetalle(p.id);
      })
      .catch((e) => this.toast.error(errorMessage(e)))
      .finally(() => this.busy.set(false));
  }

  protected haReaccionado(pubId: string, tipo: ReaccionTipo): boolean {
    return this.reaccionadas().has(`${pubId}:${tipo}`);
  }

  protected alternarReaccion(p: Publicacion, tipo: ReaccionTipo) {
    const clave = `${p.id}:${tipo}`;
    const activa = this.reaccionadas().has(clave);
    this.reaccionBusy.set(clave);
    const op = activa ? this.api.quitarReaccion(p.id, tipo) : this.api.reaccionar(p.id, tipo);
    op
      .then(() => {
        this.reaccionadas.update((set) => {
          const copia = new Set(set);
          if (activa) copia.delete(clave);
          else copia.add(clave);
          return copia;
        });
        return this.cargarDetalle(p.id);
      })
      .catch((e) => this.toast.error(errorMessage(e)))
      .finally(() => this.reaccionBusy.set(null));
  }

  protected resolver(p: Publicacion) {
    this.accionBusy.set(p.id);
    this.api
      .actualizarPublicacion(p.id, { estado: 'RESUELTA' })
      .then((actualizada) => {
        this.toast.success('Marcada como resuelta');
        this.feed.update((lista) => lista.map((x) => (x.id === p.id ? { ...x, estado: actualizada.estado } : x)));
      })
      .catch((e) => this.toast.error(errorMessage(e)))
      .finally(() => this.accionBusy.set(null));
  }

  protected archivar(p: Publicacion) {
    this.accionBusy.set(p.id);
    this.api
      .archivarPublicacion(p.id)
      .then(() => {
        this.toast.success('Publicación archivada');
        // Si el filtro no pide ver ARCHIVADA, la quitamos del muro visible.
        if (this.fEstado() !== 'ARCHIVADA') {
          this.feed.update((lista) => lista.filter((x) => x.id !== p.id));
          this.total.update((n) => Math.max(0, n - 1));
          if (this.expandido() === p.id) this.expandido.set(null);
        } else {
          this.feed.update((lista) => lista.map((x) => (x.id === p.id ? { ...x, estado: 'ARCHIVADA' } : x)));
        }
      })
      .catch((e) => this.toast.error(errorMessage(e)))
      .finally(() => this.accionBusy.set(null));
  }
}
