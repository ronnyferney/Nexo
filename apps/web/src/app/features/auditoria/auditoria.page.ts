import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuditApi } from '../../core/audit.api';
import type { AuditEntry } from '../../core/audit.models';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import {
  ACTION_LABELS,
  actionLabel,
  actorTypeIcon,
  actorTypeLabel,
  formatActor,
  formatDateTime,
  formatDateTimeFull,
  formatTarget,
  hasActiveFilters,
  hasMetadata,
  prettyMetadata,
  toSeal,
} from './auditoria.util';

/** Filtros del visor, enlazados a los controles. Cadenas vacías = sin filtro. Fechas en `YYYY-MM-DD` (día local). */
interface Filtros {
  action: string;
  targetType: string;
  targetId: string;
  desde: string;
  hasta: string;
}

const EMPTY_FILTROS: Filtros = { action: '', targetType: '', targetId: '', desde: '', hasta: '' };

/**
 * Visor de auditoría inmutable (E13). Solo ADMIN. Muestra, prominente, el SELLO DE INTEGRIDAD de la cadena
 * (`verificar()`) y la lista paginada y filtrable de hechos de gobierno, con cada fila expandible para ver sus
 * metadatos y los hashes (`hash`/`prevHash`) como prueba del encadenamiento. Solo lectura: no hay mutaciones.
 */
@Component({
  selector: 'nx-auditoria',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, EmptyStateComponent, ErrorStateComponent, LoadingStateComponent],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Auditoría</h1>
          <p>Registro inmutable y encadenado por hash de los hechos de gobierno de tu organización</p>
        </div>
        <button class="btn icon" title="Actualizar" aria-label="Actualizar" [disabled]="loading() || verifying()" (click)="reload()">
          <nx-icon name="refresh" />
        </button>
      </div>

      @if (!isAdmin()) {
        <nx-empty-state icon="lock" title="Acceso restringido"
          description="El visor de auditoría está reservado a la administración del workspace." />
      } @else {
        <!-- Sello de integridad: el corazón de la confianza. -->
        @if (verifying()) {
          <div class="seal seal-pending" role="status" aria-live="polite">
            <span class="spinner" aria-hidden="true"></span>
            <div><strong>Verificando la cadena…</strong><p class="small muted">Recomputando los hashes de todos los hechos.</p></div>
          </div>
        } @else if (sealError()) {
          <div class="seal seal-broken" role="alert">
            <nx-icon name="alert" [size]="26" />
            <div>
              <strong>No se pudo verificar la cadena</strong>
              <p class="small">{{ sealError() }}</p>
            </div>
            <button class="btn sm" (click)="verify()">Reintentar</button>
          </div>
        } @else if (seal(); as s) {
          <div class="seal" [class.seal-ok]="s.ok" [class.seal-broken]="!s.ok" [attr.role]="s.ok ? 'status' : 'alert'">
            <nx-icon [name]="s.icon" [size]="26" />
            <div>
              <strong>{{ s.titulo }} {{ s.ok ? '✓' : '✗' }}</strong>
              <p class="small">{{ s.detalle }}</p>
            </div>
          </div>
        }

        <!-- Filtros -->
        <div class="card filters">
          <label class="sr-only" for="f-action">Filtrar por acción</label>
          <select id="f-action" class="input" [(ngModel)]="filtros.action" (ngModelChange)="reload()">
            <option value="">Todas las acciones</option>
            @for (a of actionOptions; track a.value) { <option [value]="a.value">{{ a.label }}</option> }
          </select>
          <label class="field"><span class="muted small">Tipo de objetivo</span>
            <input id="f-ttype" class="input" type="text" placeholder="Ej.: Politica" [(ngModel)]="filtros.targetType"
              (keyup.enter)="reload()" />
          </label>
          <label class="field"><span class="muted small">Id de objetivo</span>
            <input id="f-tid" class="input" type="text" placeholder="Id de la entidad" [(ngModel)]="filtros.targetId"
              (keyup.enter)="reload()" />
          </label>
          <label class="field"><span class="muted small">Desde</span>
            <input class="input" type="date" [max]="filtros.hasta || today" [(ngModel)]="filtros.desde" (ngModelChange)="reload()" />
          </label>
          <label class="field"><span class="muted small">Hasta</span>
            <input class="input" type="date" [min]="filtros.desde" [max]="today" [(ngModel)]="filtros.hasta" (ngModelChange)="reload()" />
          </label>
          <button class="btn" (click)="reload()"><nx-icon name="search" [size]="15" />Aplicar</button>
          @if (hasFilters()) {
            <button class="btn ghost" (click)="clearFilters()"><nx-icon name="x" [size]="15" />Limpiar</button>
          }
        </div>

        @if (error()) {
          <nx-error-state title="No se pudo cargar la auditoría" message="{{ error() }}" (retry)="reload()" />
        } @else if (loading() && !items().length) {
          <nx-loading-state text="Cargando hechos de auditoría…" />
        } @else if (items().length) {
          <div class="card" style="padding:0">
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th scope="col" style="width:40px"></th>
                    <th scope="col">#</th>
                    <th scope="col">Fecha</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Acción</th>
                    <th scope="col">Objetivo</th>
                    <th scope="col">Resumen</th>
                  </tr>
                </thead>
                <tbody>
                  @for (e of items(); track e.id) {
                    <tr class="row-main" [class.expanded]="isExpanded(e.id)">
                      <td>
                        <button class="btn icon sm" [attr.aria-expanded]="isExpanded(e.id)"
                          [attr.aria-label]="isExpanded(e.id) ? 'Contraer detalle' : 'Ver detalle'"
                          [title]="isExpanded(e.id) ? 'Contraer' : 'Expandir'" (click)="toggle(e.id)">
                          <nx-icon [name]="isExpanded(e.id) ? 'chevronUp' : 'chevronDown'" [size]="16" />
                        </button>
                      </td>
                      <td class="mono small">{{ e.seq }}</td>
                      <td class="muted small nowrap" [title]="full(e.createdAt)">{{ dt(e.createdAt) }}</td>
                      <td class="nowrap">
                        <span class="badge"><nx-icon [name]="actorIcon(e.actorType)" [size]="13" />{{ actorLabel(e.actorType) }}</span>
                        @if (e.actorType !== 'SYSTEM' && e.actorId) { <div class="mono xsmall muted" [title]="e.actorId">{{ e.actorId }}</div> }
                      </td>
                      <td><span class="badge primary">{{ label(e.action) }}</span></td>
                      <td class="small nowrap">{{ target(e.targetType, e.targetId) }}</td>
                      <td class="small">{{ e.resumen }}</td>
                    </tr>
                    @if (isExpanded(e.id)) {
                      <tr class="row-detail">
                        <td colspan="7">
                          <div class="detail">
                            <div class="kv">
                              <span class="k">Acción (código)</span><span class="v mono small">{{ e.action }}</span>
                              <span class="k">Actor</span><span class="v small">{{ actor(e.actorType, e.actorId) }}</span>
                              <span class="k">Objetivo</span><span class="v small">{{ target(e.targetType, e.targetId) }}</span>
                              <span class="k">Fecha</span><span class="v small">{{ full(e.createdAt) }}</span>
                            </div>
                            <div class="hashes">
                              <div class="hash-row">
                                <span class="k">Hash previo</span>
                                <code class="mono xsmall">{{ e.prevHash }}</code>
                              </div>
                              <div class="hash-row">
                                <span class="k">Hash de contenido</span>
                                <code class="mono xsmall">{{ e.contentHash }}</code>
                              </div>
                              <div class="hash-row">
                                <span class="k">Hash de la entrada</span>
                                <code class="mono xsmall">{{ e.hash }}</code>
                              </div>
                              <p class="xsmall muted">El hash de esta entrada se encadena con el hash previo: alterar o borrar cualquier hecho rompe la cadena.</p>
                            </div>
                            <div class="meta">
                              <span class="k">Metadatos</span>
                              @if (showMeta(e)) {
                                <pre class="code-block mono xsmall">{{ meta(e.metadata) }}</pre>
                              } @else {
                                <p class="small muted">Sin metadatos adicionales.</p>
                              }
                            </div>
                          </div>
                        </td>
                      </tr>
                    }
                  }
                </tbody>
              </table>
            </div>
          </div>
          @if (nextCursor()) {
            <div class="row" style="justify-content:center; margin-top:16px">
              <button class="btn" [disabled]="loading()" (click)="more()">{{ loading() ? 'Cargando…' : 'Cargar más' }}</button>
            </div>
          }
        } @else if (hasFilters()) {
          <nx-empty-state icon="search" title="Sin resultados"
            description="Ningún hecho coincide con los filtros aplicados." actionLabel="Limpiar filtros" actionIcon="x"
            (action)="clearFilters()" />
        } @else {
          <nx-empty-state icon="shield" title="Sin hechos registrados"
            description="Cuando ocurran hechos de gobierno (aprobaciones, suspensiones, cambios de política…), quedarán aquí de forma inmutable." />
        }
      }
    </div>
  `,
  styles: `
    .seal { display: flex; align-items: center; gap: 14px; padding: 16px 18px; border-radius: 12px; border: 1px solid var(--border); margin-bottom: 18px; }
    .seal strong { font-size: 17px; display: block; }
    .seal p { margin: 2px 0 0; }
    .seal .btn { margin-left: auto; }
    .seal-ok { background: var(--success-50); border-color: var(--success); }
    .seal-ok strong, .seal-ok nx-icon { color: var(--success); }
    .seal-broken { background: var(--danger-50); border-color: var(--danger); }
    .seal-broken strong, .seal-broken nx-icon { color: var(--danger); }
    .seal-pending { background: var(--surface-2); }
    .filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; margin-bottom: 16px; }
    .filters .input { width: 180px; max-width: 100%; }
    .filters .field { display: flex; flex-direction: column; gap: 3px; }
    .filters .field .input { width: 160px; }
    .xsmall { font-size: 11px; }
    .row-detail > td { background: var(--surface-2); padding: 0; }
    .detail { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(260px, 1.4fr) minmax(220px, 1fr); gap: 18px; padding: 16px 18px; }
    .kv { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; align-items: start; }
    .k { font-weight: 600; color: var(--muted); font-size: 12px; }
    .v { min-width: 0; word-break: break-word; }
    .hashes { display: flex; flex-direction: column; gap: 8px; }
    .hash-row { display: flex; flex-direction: column; gap: 2px; }
    .hash-row code { word-break: break-all; }
    .meta { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .meta pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
    @media (max-width: 900px) { .detail { grid-template-columns: 1fr; } }
    @media (max-width: 520px) { .filters .input, .filters .field, .filters .field .input { width: 100%; } }
  `,
})
export class AuditoriaPage implements OnInit {
  private readonly api = inject(AuditApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly isAdmin = computed(() => this.auth.isAdmin());

  readonly items = signal<AuditEntry[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly seal = signal<ReturnType<typeof toSeal> | null>(null);
  readonly verifying = signal(false);
  readonly sealError = signal<string | null>(null);

  private readonly expanded = signal<Set<string>>(new Set());

  filtros: Filtros = { ...EMPTY_FILTROS };
  readonly actionOptions = Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }));
  readonly today = new Date().toISOString().slice(0, 10);
  readonly hasFilters = computed(() => hasActiveFilters(this.filtros));

  // Presentación (delegada en la lógica pura).
  readonly label = actionLabel;
  readonly actor = formatActor;
  readonly actorLabel = actorTypeLabel;
  readonly actorIcon = actorTypeIcon;
  readonly target = formatTarget;
  readonly dt = formatDateTime;
  readonly full = formatDateTimeFull;
  readonly showMeta = hasMetadata;
  readonly meta = prettyMetadata;

  ngOnInit() {
    if (!this.isAdmin()) {
      this.loading.set(false);
      return;
    }
    void this.verify();
    void this.reload();
  }

  async verify() {
    this.verifying.set(true);
    this.sealError.set(null);
    try {
      this.seal.set(toSeal(await this.api.verificar()));
    } catch (e) {
      this.sealError.set(errorMessage(e));
    } finally {
      this.verifying.set(false);
    }
  }

  reload() {
    void this.load();
    void this.verify();
  }

  private async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const r = await this.api.listar(this.toFilters());
      this.items.set(r.items);
      this.nextCursor.set(r.nextCursor);
      this.expanded.set(new Set());
    } catch (e) {
      this.items.set([]);
      this.nextCursor.set(null);
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async more() {
    this.loading.set(true);
    try {
      const r = await this.api.listar(this.toFilters(), { cursor: this.nextCursor() });
      this.items.update((i) => [...i, ...r.items]);
      this.nextCursor.set(r.nextCursor);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  clearFilters() {
    this.filtros = { ...EMPTY_FILTROS };
    void this.load();
  }

  toggle(id: string) {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  isExpanded(id: string): boolean {
    return this.expanded().has(id);
  }

  /** Convierte las fechas de día local a instantes ISO (desde al inicio del día, hasta al final). */
  private toFilters() {
    const f = this.filtros;
    return {
      action: f.action || undefined,
      targetType: f.targetType.trim() || undefined,
      targetId: f.targetId.trim() || undefined,
      desde: f.desde ? new Date(`${f.desde}T00:00:00`).toISOString() : undefined,
      hasta: f.hasta ? new Date(`${f.hasta}T23:59:59.999`).toISOString() : undefined,
    };
  }
}
