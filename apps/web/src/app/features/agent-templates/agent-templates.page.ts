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
import { Router } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import {
  type Agent,
  type AgentTemplate,
  type AgentTemplateDetail,
  type AgentTemplateInstallResult,
  NIVEL_LABELS,
} from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { PageHeaderComponent } from '../../layout/page-header.component';

/** Borrador del formulario de publicación de una plantilla desde un agente existente. */
interface PublishDraft {
  agentId: string;
  nombre: string;
  area: string;
  notas: string;
}

/**
 * Agent Hub (ADR 0019 · Inc.2): galería de plantillas gobernadas de empleado digital. Cualquier miembro puede
 * descubrir y abrir el detalle (versiones). Publicar desde un agente existente e instalar un borrador requieren
 * EDITOR+. Instalar nunca concede accesos ni lanza el agente: crea un BORRADOR sin responsable y muestra el aviso.
 */
@Component({
  selector: 'nx-agent-templates',
  imports: [
    FormsModule,
    IconComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    LoadingStateComponent,
    PageHeaderComponent,
    RelativeTimePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nx-page-header
        heading="Hub de plantillas"
        description="Plantillas gobernadas de empleados digitales: descubra, vea versiones e instale. Instalar crea un borrador sin responsable ni secretos; no concede accesos ni lo lanza."
      >
        <div actions>
          @if (canEdit()) {
            <button class="btn primary brand" (click)="openPublish()"><nx-icon name="upload" />Publicar plantilla</button>
          }
        </div>
      </nx-page-header>

      @if (error()) {
        <nx-error-state message="{{ error() }}" title="No se pudo cargar el hub de plantillas" (retry)="load()" />
      } @else if (loading()) {
        <nx-loading-state text="Cargando el catálogo de plantillas…" />
      } @else if (!templates().length) {
        <nx-empty-state
          icon="template"
          title="Sin plantillas"
          description="Aún no hay plantillas publicadas en este workspace. Publique una a partir de un agente existente para reutilizar su configuración."
          [actionLabel]="canEdit() ? 'Publicar plantilla' : ''"
          actionIcon="upload"
          (action)="openPublish()"
        />
      } @else {
        <div class="gallery">
          @for (t of sorted(); track t.id) {
            <button type="button" class="card tpl-card" (click)="openDetail(t)">
              <div class="t-head">
                <div class="icon-tile"><nx-icon name="template" /></div>
                <div class="grow">
                  <div class="title-row">
                    <h2>{{ t.nombre }}</h2>
                  </div>
                  <div class="badges">
                    @if (t.area) { <span class="badge">{{ t.area }}</span> }
                    @if (t.nivel) { <span class="badge info">{{ nivelLabels[t.nivel] }}</span> }
                  </div>
                </div>
              </div>
              @if (t.descripcion) { <p class="muted small desc">{{ t.descripcion }}</p> }
              <div class="t-foot">
                <span class="muted small"><nx-icon name="layers" [size]="13" /> {{ versionesLabel(t.versionesCount) }}</span>
                <span class="muted small">Actualizada {{ t.updatedAt | ago }}</span>
              </div>
            </button>
          }
        </div>
      }
    </div>

    @if (detailOpen()) {
      <dialog #detailDlg class="modal lg" aria-labelledby="tpl-detail-title" (close)="onDetailClose()">
        <div class="modal-head">
          <div class="icon-tile"><nx-icon name="template" /></div>
          <div class="grow">
            <h2 id="tpl-detail-title">{{ detail()?.nombre ?? 'Plantilla' }}</h2>
            <span class="small muted">Versiones publicadas de la plantilla.</span>
          </div>
          <button class="btn sm icon" title="Cerrar" aria-label="Cerrar" (click)="closeDetail()"><nx-icon name="x" [size]="16" /></button>
        </div>
        <div class="modal-body">
          @if (detailError()) {
            <nx-error-state message="{{ detailError() }}" title="No se pudo cargar la plantilla" (retry)="reloadDetail()" />
          } @else if (detailLoading()) {
            <nx-loading-state text="Cargando versiones…" />
          } @else if (detail(); as d) {
            <div class="badges">
              @if (d.area) { <span class="badge">{{ d.area }}</span> }
              @if (d.nivel) { <span class="badge info">{{ nivelLabels[d.nivel] }}</span> }
            </div>
            @if (d.descripcion) { <p class="muted small m0">{{ d.descripcion }}</p> }

            @if (installResult(); as r) {
              <div class="callout success" role="status">
                <nx-icon name="checkCircle" [size]="18" />
                <div class="grow">
                  <strong>Borrador creado desde la versión {{ r.version }}.</strong>
                  <p class="small m0">{{ r.aviso }}</p>
                  <div class="row wrap gap">
                    <button type="button" class="btn sm primary" (click)="goToAgent(r.agentId)"><nx-icon name="arrowRight" [size]="14" />Ir al agente creado</button>
                    <span class="muted small">{{ r.skillsVinculadas }} skill(s) y {{ r.operacionesVinculadas }} operación(es) vinculadas.</span>
                  </div>
                </div>
              </div>
            }

            @if (canEdit()) {
              <div class="install-bar">
                <button type="button" class="btn primary" [disabled]="installing() || !d.versiones.length" (click)="install(d)">
                  <nx-icon name="rocket" [size]="16" />{{ installing() ? 'Instalando…' : 'Instalar última versión' }}
                </button>
                <span class="hint">Crea un agente en borrador; luego asigne responsable y secretos por bóveda.</span>
              </div>
            }

            @if (!d.versiones.length) {
              <nx-empty-state icon="layers" title="Sin versiones" description="Esta plantilla aún no tiene versiones publicadas." />
            } @else {
              <ul class="versions">
                @for (v of reversed(d.versiones); track v.id) {
                  <li class="version">
                    <div class="v-head">
                      <span class="badge">v{{ v.version }}</span>
                      @if (v.version === latestVersion(d)) { <span class="badge info">Última</span> }
                      <span class="muted small grow">Publicada {{ v.createdAt | ago }}</span>
                      @if (canEdit()) {
                        <button type="button" class="btn sm" [disabled]="installing()" (click)="install(d, v.version)" title="Instalar esta versión" aria-label="Instalar esta versión">
                          <nx-icon name="rocket" [size]="13" />Instalar
                        </button>
                      }
                    </div>
                    @if (v.notas) { <p class="small m0 notas">{{ v.notas }}</p> }
                  </li>
                }
              </ul>
            }
          }
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" (click)="closeDetail()">Cerrar</button>
        </div>
      </dialog>
    }

    @if (publishDraft(); as p) {
      <dialog #publishDlg class="modal" aria-labelledby="tpl-publish-title" (cancel)="onPublishCancel($event)" (close)="publishDraft.set(null)">
        <form (ngSubmit)="publish()">
          <div class="modal-head">
            <div class="icon-tile"><nx-icon name="upload" /></div>
            <div class="grow">
              <h2 id="tpl-publish-title">Publicar plantilla</h2>
              <span class="small muted">Se publica a partir de un agente existente. El contenido se sanea: nunca incluye secretos ni responsable.</span>
            </div>
          </div>
          <div class="modal-body">
            @if (agentsError()) {
              <div class="callout danger" role="alert"><nx-icon name="alert" [size]="16" /><span>{{ agentsError() }}</span></div>
            } @else if (agentsLoading()) {
              <nx-loading-state text="Cargando agentes…" size="sm" />
            } @else if (!agents().length) {
              <nx-empty-state icon="bot" title="Sin agentes" description="No hay agentes en el workspace desde los que publicar una plantilla." />
            } @else {
              <div class="field">
                <label for="tpl-agent">Agente de origen <abbr class="req" title="Obligatorio" aria-hidden="true">*</abbr></label>
                <select id="tpl-agent" class="input" required [ngModel]="p.agentId" (ngModelChange)="patchPublish({ agentId: $event })" name="agentId">
                  <option value="" disabled>Seleccione un agente…</option>
                  @for (a of agents(); track a.id) { <option [value]="a.id">{{ a.name }}</option> }
                </select>
                <span class="hint">Si ya existe una plantilla para ese agente, se agrega una versión nueva.</span>
              </div>
              <div class="field">
                <label for="tpl-nombre">Nombre</label>
                <input id="tpl-nombre" class="input" maxlength="80" [ngModel]="p.nombre" (ngModelChange)="patchPublish({ nombre: $event })" name="nombre" placeholder="Por defecto, el nombre del agente" />
              </div>
              <div class="field">
                <label for="tpl-area">Área o proceso</label>
                <input id="tpl-area" class="input" maxlength="120" [ngModel]="p.area" (ngModelChange)="patchPublish({ area: $event })" name="area" placeholder="Ej.: Ventas, Soporte, Finanzas" />
              </div>
              <div class="field">
                <label for="tpl-notas">Notas de la versión</label>
                <textarea id="tpl-notas" class="input" rows="3" maxlength="2000" [ngModel]="p.notas" (ngModelChange)="patchPublish({ notas: $event })" name="notas" placeholder="Qué cambia en esta versión (changelog)"></textarea>
              </div>
            }
            @if (publishError()) {
              <div class="callout danger" role="alert"><nx-icon name="alert" [size]="16" /><span>{{ publishError() }}</span></div>
            }
          </div>
          <div class="modal-foot">
            <button type="button" class="btn" (click)="closePublish()">Cancelar</button>
            <button type="submit" class="btn primary" [disabled]="publishing() || !p.agentId">
              <nx-icon name="upload" [size]="16" />{{ publishing() ? 'Publicando…' : 'Publicar' }}
            </button>
          </div>
        </form>
      </dialog>
    }
  `,
  styles: `
    .gallery { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); align-items: start; }
    .tpl-card { display: flex; flex-direction: column; gap: 10px; text-align: left; cursor: pointer; border: 1px solid var(--border); background: var(--surface); width: 100%; }
    .tpl-card:hover { border-color: var(--brand); }
    .t-head { display: flex; gap: 12px; align-items: flex-start; }
    .grow { flex: 1; min-width: 0; }
    .title-row h2 { margin: 0; font-size: 16px; overflow-wrap: anywhere; }
    .badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
    .desc { margin: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .t-foot { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: auto; }
    .t-foot nx-icon { vertical-align: -2px; }
    .modal.lg { max-width: 640px; width: 100%; }
    .modal-body { display: flex; flex-direction: column; gap: 14px; }
    .m0 { margin: 0; }
    .row { display: flex; align-items: center; }
    .wrap { flex-wrap: wrap; }
    .gap { gap: 8px; }
    .field { display: flex; flex-direction: column; gap: 6px; }
    .hint { font-size: 12px; color: var(--muted); }
    .install-bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2, var(--surface)); }
    .install-bar .hint { flex: 1; min-width: 140px; }
    .versions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .version { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
    .v-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .notas { color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; }
    .callout.success .grow { display: flex; flex-direction: column; gap: 8px; }
    @media (max-width: 560px) { .gallery { grid-template-columns: 1fr; } }
  `,
})
export class AgentTemplatesPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly detailDialog = viewChild<ElementRef<HTMLDialogElement>>('detailDlg');
  private readonly publishDialog = viewChild<ElementRef<HTMLDialogElement>>('publishDlg');

  readonly nivelLabels = NIVEL_LABELS;
  readonly canEdit = this.auth.canEdit;

  readonly templates = signal<AgentTemplate[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  /** Más reciente primero. */
  readonly sorted = computed(() =>
    [...this.templates()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );

  // Detalle
  readonly detailOpen = signal(false);
  readonly detail = signal<AgentTemplateDetail | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal<string | null>(null);
  readonly installing = signal(false);
  readonly installResult = signal<AgentTemplateInstallResult | null>(null);
  private currentId: string | null = null;

  // Publicación
  readonly publishDraft = signal<PublishDraft | null>(null);
  readonly publishing = signal(false);
  readonly publishError = signal<string | null>(null);
  readonly agents = signal<Agent[]>([]);
  readonly agentsLoading = signal(false);
  readonly agentsError = signal<string | null>(null);

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.templates.set(await this.api.agentTemplates());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  versionesLabel(n: number): string {
    return n === 1 ? '1 versión' : `${n} versiones`;
  }

  reversed(list: AgentTemplateDetail['versiones']): AgentTemplateDetail['versiones'] {
    return [...list].reverse();
  }

  latestVersion(d: AgentTemplateDetail): number {
    return d.versiones.reduce((max, v) => Math.max(max, v.version), 0);
  }

  // --- Detalle ---------------------------------------------------------------

  openDetail(t: AgentTemplate) {
    this.currentId = t.id;
    this.detail.set(null);
    this.installResult.set(null);
    this.detailError.set(null);
    this.detailOpen.set(true);
    afterNextRender(() => this.detailDialog()?.nativeElement.showModal(), { injector: this.injector });
    void this.reloadDetail();
  }

  async reloadDetail() {
    const id = this.currentId;
    if (!id) return;
    this.detailLoading.set(true);
    this.detailError.set(null);
    try {
      this.detail.set(await this.api.agentTemplate(id));
    } catch (e) {
      this.detailError.set(errorMessage(e));
    } finally {
      this.detailLoading.set(false);
    }
  }

  closeDetail() {
    if (!this.installing()) this.detailDialog()?.nativeElement.close();
  }

  onDetailClose() {
    this.detailOpen.set(false);
    this.detail.set(null);
    this.currentId = null;
  }

  async install(d: AgentTemplateDetail, version?: number) {
    if (this.installing()) return;
    this.installing.set(true);
    try {
      const res = await this.api.installAgentTemplate(d.id, version);
      this.installResult.set(res);
      this.toast.success(`Agente en borrador creado desde la versión ${res.version}`);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.installing.set(false);
    }
  }

  goToAgent(agentId: string) {
    this.detailDialog()?.nativeElement.close();
    void this.router.navigate(['/agents', agentId]);
  }

  // --- Publicación -----------------------------------------------------------

  openPublish() {
    if (!this.canEdit()) return;
    this.publishError.set(null);
    this.publishDraft.set({ agentId: '', nombre: '', area: '', notas: '' });
    afterNextRender(() => this.publishDialog()?.nativeElement.showModal(), { injector: this.injector });
    void this.loadAgents();
  }

  private async loadAgents() {
    this.agentsLoading.set(true);
    this.agentsError.set(null);
    try {
      this.agents.set(await this.api.agents());
    } catch (e) {
      this.agentsError.set(errorMessage(e));
    } finally {
      this.agentsLoading.set(false);
    }
  }

  patchPublish(part: Partial<PublishDraft>) {
    this.publishDraft.update((d) => (d ? { ...d, ...part } : d));
  }

  closePublish() {
    if (!this.publishing()) this.publishDialog()?.nativeElement.close();
  }

  onPublishCancel(ev: Event) {
    if (this.publishing()) ev.preventDefault();
  }

  async publish() {
    const d = this.publishDraft();
    if (!d || this.publishing() || !d.agentId) return;
    this.publishing.set(true);
    this.publishError.set(null);
    try {
      const tpl = await this.api.publishAgentTemplate({
        agentId: d.agentId,
        nombre: d.nombre.trim() || undefined,
        area: d.area.trim() || undefined,
        notas: d.notas.trim() || undefined,
      });
      this.toast.success(`Plantilla «${tpl.nombre}» publicada (versión ${this.latestVersion(tpl)})`);
      this.publishing.set(false);
      this.publishDialog()?.nativeElement.close();
      await this.load();
    } catch (e) {
      this.publishError.set(errorMessage(e));
      this.publishing.set(false);
    }
  }
}
