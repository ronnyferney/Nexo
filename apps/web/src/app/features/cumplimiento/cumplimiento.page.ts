import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ComplianceApi } from '../../core/compliance.api';
import {
  NIVELES_RIESGO,
  TIPOS_DATO,
  type NivelRiesgo,
  type ReglaCumplimiento,
  type TipoDatoCumplimiento,
} from '../../core/compliance.models';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { AuditApi } from '../../core/audit.api';
import type { AuditEntry } from '../../core/audit.models';
import { actionLabel, formatDateTime } from '../auditoria/auditoria.util';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { TemplateRefPipe } from '../../shared/template-ref.pipe';
import {
  alcanceTexto,
  draftAInput,
  draftDeRegla,
  EMPTY_FILTROS,
  esObligatoria,
  filtrarReglas,
  hayFiltrosActivos,
  nivelRiesgoLabel,
  nuevoDraft,
  reglaValidacionResumen,
  tipoDatoLabel,
  validarDraft,
  valoresDistintos,
  type ReglaDraft,
  type ReglaFiltros,
} from './cumplimiento.util';

/**
 * Consola de la matriz de cumplimiento configurable (P1.3 · ADR 0020). Administra reglas, su ALCANCE
 * (jurisdicción/sector/proceso/riesgo), obligatoriedad, validación declarativa y activación —todo DESDE LA PLATAFORMA,
 * sin intervención técnica—, con la auditoría de los cambios. La evaluación es ASESORA (no bloqueante): las reglas solo
 * rigen una vez ACTIVADAS por un ADMIN y aprobado el conjunto por el patrocinador; nunca afirma conformidad normativa.
 * Solo ADMIN/OWNER (el gate real lo impone el servidor).
 */
@Component({
  selector: 'nx-cumplimiento',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    IconComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    LoadingStateComponent,
    TemplateRefPipe,
  ],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Cumplimiento</h1>
          <p>Matriz configurable de reglas por jurisdicción, sector, proceso y riesgo. Administración gobernada y auditada.</p>
        </div>
        <button class="btn" title="Actualizar" aria-label="Actualizar" [disabled]="loading()" (click)="load()">
          <nx-icon name="refresh" [size]="15" />Actualizar
        </button>
      </div>

      @if (!isAdmin()) {
        <nx-empty-state icon="lock" title="Acceso restringido"
          description="La consola de cumplimiento está reservada a la administración del workspace (ADMIN/OWNER)." />
      } @else {
        <div class="callout info" style="margin-bottom:16px">
          <nx-icon name="info" [size]="16" />
          <span>Las reglas son <strong>asesoras</strong> (no bloqueantes) y nacen <strong>inactivas</strong>: no exigen
          nada hasta que un administrador las active y el patrocinador apruebe el conjunto. La plataforma no afirma
          conformidad con ninguna norma. Gana la regla <strong>más específica</strong> por cada campo clave.</span>
        </div>

        <!-- Formulario de alta/edición -->
        @if (canEdit() && draft(); as d) {
          <div class="card stack" style="margin-bottom:16px">
            <div class="card-title">
              <div class="icon-tile"><nx-icon name="scale" /></div>
              <div>
                <h2>{{ d.id ? 'Editar' : 'Nueva' }} regla de cumplimiento</h2>
                <p class="muted small" style="margin:0">El alcance vacío actúa como comodín (aplica a todas las opciones)</p>
              </div>
              <span class="spacer"></span>
              <button class="btn ghost icon" title="Cerrar" aria-label="Cerrar formulario" (click)="draft.set(null)">
                <nx-icon name="x" />
              </button>
            </div>

            <fieldset class="fs">
              <legend>Alcance</legend>
              <div class="grid grid-2">
                <div class="field"><label for="c-jur">Jurisdicción</label>
                  <input id="c-jur" class="input" type="text" maxlength="120" [(ngModel)]="d.jurisdiccion"
                    placeholder="Vacío = todas (p. ej. EC, CO, UE)" /></div>
                <div class="field"><label for="c-sec">Sector</label>
                  <input id="c-sec" class="input" type="text" maxlength="120" [(ngModel)]="d.sector"
                    placeholder="Vacío = todos (p. ej. financiero, salud)" /></div>
                <div class="field"><label for="c-pro">Proceso</label>
                  <input id="c-pro" class="input" type="text" maxlength="120" [(ngModel)]="d.proceso"
                    placeholder="Vacío = todos (p. ej. cobranza, onboarding)" /></div>
                <div class="field"><label for="c-rie">Nivel de riesgo</label>
                  <select id="c-rie" class="input" [(ngModel)]="d.nivelRiesgo">
                    <option value="">Todos</option>
                    @for (n of niveles; track n) { <option [value]="n">{{ nivelLabel(n) }}</option> }
                  </select></div>
              </div>
            </fieldset>

            <fieldset class="fs">
              <legend>Campo</legend>
              <div class="grid grid-2">
                <div class="field"><label for="c-campo">Campo clave <span class="req">*</span></label>
                  <input id="c-campo" class="input" type="text" maxlength="120" [(ngModel)]="d.campoClave"
                    placeholder="Identificador en inglés, p. ej. baseLegalTratamiento" /></div>
                <div class="field"><label for="c-tipo">Tipo de dato</label>
                  <select id="c-tipo" class="input" [(ngModel)]="d.tipoDato">
                    @for (t of tipos; track t) { <option [value]="t">{{ tipoLabel(t) }}</option> }
                  </select></div>
              </div>
              <div class="field"><label for="c-desc">Descripción</label>
                <textarea id="c-desc" class="input" rows="2" maxlength="1000" [(ngModel)]="d.descripcion"
                  placeholder="Descripción legible del requisito"></textarea></div>
              <div class="field"><label for="c-prot">Control de protección de datos</label>
                <input id="c-prot" class="input" type="text" maxlength="200" [(ngModel)]="d.controlProteccion"
                  placeholder="p. ej. minimización, consentimiento" /></div>
            </fieldset>

            <fieldset class="fs">
              <legend>Validación</legend>
              <label class="choice" style="max-width:none">
                <input type="checkbox" name="c-req" [(ngModel)]="d.requerido" />
                <span><strong>Obligatorio</strong> — el campo debe estar presente (obligatoriedad). Desmárquelo para hacerlo opcional.</span>
              </label>
              <div class="grid grid-2">
                @if (d.tipoDato === 'NUMERO') {
                  <div class="field"><label for="c-min">Mínimo</label>
                    <input id="c-min" class="input" type="number" [(ngModel)]="d.min" placeholder="Sin mínimo" /></div>
                  <div class="field"><label for="c-max">Máximo</label>
                    <input id="c-max" class="input" type="number" [(ngModel)]="d.max" placeholder="Sin máximo" /></div>
                }
                @if (d.tipoDato === 'TEXTO' || d.tipoDato === 'LISTA') {
                  <div class="field"><label for="c-lmin">Longitud mínima</label>
                    <input id="c-lmin" class="input" type="number" min="0" [(ngModel)]="d.longitudMin" placeholder="Sin mínimo" /></div>
                  <div class="field"><label for="c-lmax">Longitud máxima</label>
                    <input id="c-lmax" class="input" type="number" min="0" [(ngModel)]="d.longitudMax" placeholder="Sin máximo" /></div>
                }
              </div>
              @if (d.tipoDato === 'TEXTO') {
                <div class="field"><label for="c-pat">Patrón (expresión regular)</label>
                  <input id="c-pat" class="input mono" type="text" [(ngModel)]="d.patron"
                    placeholder="p. ej. ^[A-Z]{2}\\d{4}$" /></div>
              }
              <div class="field"><label for="c-enum">Valores permitidos (uno por línea)</label>
                <textarea id="c-enum" class="input" rows="3" [(ngModel)]="d.enumTexto"
                  placeholder="Vacío = sin restricción de conjunto"></textarea>
                <span class="hint">Si se indican, el valor debe ser uno de la lista (enum cerrado).</span></div>
            </fieldset>

            <fieldset class="fs">
              <legend>Vigencia</legend>
              <div class="callout warning">
                <nx-icon name="clock" [size]="16" />
                <span>El contrato actual del backend no expone fechas de vigencia (inicio/fin) para las reglas. La
                obligatoriedad se gobierna hoy con el estado <strong>activa/inactiva</strong>. Administrar rangos de
                vigencia requiere una <strong>extensión aditiva del backend</strong> (campos de vigencia en el modelo y el
                contrato); no se simula desde la web.</span>
              </div>
            </fieldset>

            <fieldset class="fs">
              <legend>Estado</legend>
              <label class="choice" style="max-width:none">
                <input type="checkbox" name="c-act" [(ngModel)]="d.activa" />
                <span><strong>Activa</strong> — la regla es asesora (no bloqueante) y se tendrá en cuenta al resolver y
                evaluar. Déjela inactiva hasta que el patrocinador apruebe el conjunto.</span>
              </label>
            </fieldset>

            <div class="row">
              <span class="spacer"></span>
              <button class="btn" (click)="draft.set(null)">Cancelar</button>
              <button class="btn primary" [disabled]="saving()" (click)="save()">
                <nx-icon name="save" />{{ saving() ? 'Guardando…' : 'Guardar regla' }}
              </button>
            </div>
          </div>
        }

        <!-- Filtros -->
        <div class="card filters">
          <label class="field"><span class="muted small">Jurisdicción</span>
            <select class="input" [(ngModel)]="filtros.jurisdiccion" (ngModelChange)="onFiltro()">
              <option value="">Todas</option>
              @for (j of jurisdicciones(); track j) { <option [value]="j">{{ j }}</option> }
            </select></label>
          <label class="field"><span class="muted small">Sector</span>
            <select class="input" [(ngModel)]="filtros.sector" (ngModelChange)="onFiltro()">
              <option value="">Todos</option>
              @for (s of sectores(); track s) { <option [value]="s">{{ s }}</option> }
            </select></label>
          <label class="field"><span class="muted small">Proceso</span>
            <select class="input" [(ngModel)]="filtros.proceso" (ngModelChange)="onFiltro()">
              <option value="">Todos</option>
              @for (p of procesos(); track p) { <option [value]="p">{{ p }}</option> }
            </select></label>
          <label class="field"><span class="muted small">Riesgo</span>
            <select class="input" [(ngModel)]="filtros.nivelRiesgo" (ngModelChange)="onFiltro()">
              <option value="">Todos</option>
              @for (n of niveles; track n) { <option [value]="n">{{ nivelLabel(n) }}</option> }
            </select></label>
          <label class="field"><span class="muted small">Estado</span>
            <select class="input" [(ngModel)]="filtros.estado" (ngModelChange)="onFiltro()">
              <option value="">Todos</option>
              <option value="activa">Solo activas</option>
              <option value="inactiva">Solo inactivas</option>
            </select></label>
          <label class="field grow"><span class="muted small">Buscar</span>
            <input class="input" type="search" [(ngModel)]="filtros.texto" (ngModelChange)="onFiltro()"
              placeholder="Campo clave, descripción o control" /></label>
          @if (hayFiltros()) {
            <button class="btn ghost" (click)="limpiar()"><nx-icon name="x" [size]="15" />Limpiar</button>
          }
          @if (canEdit() && !draft()) {
            <button class="btn primary" (click)="nueva()"><nx-icon name="plus" [size]="15" />Nueva regla</button>
          }
        </div>

        @if (error()) {
          <nx-error-state title="No se pudieron cargar las reglas" message="{{ error() }}" (retry)="load()" />
        } @else if (loading() && !reglas().length) {
          <nx-loading-state text="Cargando reglas de cumplimiento…" />
        } @else if (visibles().length) {
          <div class="card" style="padding:0">
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th scope="col">Estado</th>
                    <th scope="col">Campo clave</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Alcance</th>
                    <th scope="col">Validación</th>
                    <th scope="col">Protección</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of visibles(); track r.id) {
                    <tr>
                      <td class="nowrap">
                        @if (r.activa) {
                          <span class="badge success"><nx-icon name="checkCircle" [size]="13" />Activa</span>
                        } @else {
                          <span class="badge"><nx-icon name="xCircle" [size]="13" />Inactiva</span>
                        }
                      </td>
                      <td>
                        <div class="mono">{{ r.campoClave }}</div>
                        @if (r.descripcion) { <div class="muted xsmall">{{ r.descripcion }}</div> }
                      </td>
                      <td class="small nowrap">{{ tipoLabel(r.tipoDato) }}</td>
                      <td class="small">{{ alcance(r) }}</td>
                      <td class="small">
                        @if (obligatoria(r)) { <span class="badge warning">Obligatorio</span> }
                        @else { <span class="badge">Opcional</span> }
                        <div class="muted xsmall">{{ validacion(r) }}</div>
                      </td>
                      <td class="small">{{ r.controlProteccion || '—' }}</td>
                      <td class="num nowrap">
                        @if (canEdit()) {
                          <button class="btn sm" (click)="editar(r)" title="Editar" aria-label="Editar regla">
                            <nx-icon name="pencil" [size]="14" />Editar
                          </button>
                          @if (r.activa) {
                            <button class="btn ghost sm" (click)="alternar(r)" [disabled]="toggling() === r.id"
                              title="Inactivar" aria-label="Inactivar regla"><nx-icon name="xCircle" [size]="14" />Inactivar</button>
                          } @else {
                            <button class="btn ghost sm" (click)="alternar(r)" [disabled]="toggling() === r.id"
                              title="Activar" aria-label="Activar regla"><nx-icon name="checkCircle" [size]="14" />Activar</button>
                          }
                          <button class="btn ghost icon sm danger" (click)="eliminar(r)" title="Eliminar"
                            aria-label="Eliminar regla"><nx-icon name="trash" [size]="14" /></button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
          <p class="muted small" style="margin-top:8px">{{ resumenConteo() }}</p>
        } @else if (hayFiltros()) {
          <nx-empty-state icon="search" title="Sin resultados"
            description="Ninguna regla coincide con los filtros aplicados." actionLabel="Limpiar filtros" actionIcon="x"
            (action)="limpiar()" />
        } @else {
          <nx-empty-state icon="scale" title="Sin reglas de cumplimiento"
            description="Defina la primera regla de la matriz. Nacerá inactiva y asesora hasta que la active y el patrocinador apruebe el conjunto."
            [actionLabel]="canEdit() ? 'Nueva regla' : ''" actionIcon="plus" (action)="nueva()" />
        }

        <!-- Auditoría de cambios de reglas -->
        <div class="card stack" style="margin-top:20px">
          <div class="card-title">
            <div class="icon-tile"><nx-icon name="history" /></div>
            <div>
              <h2>Auditoría de cambios</h2>
              <p class="muted small" style="margin:0">Altas, modificaciones y bajas de reglas (registro inmutable)</p>
            </div>
            <span class="spacer"></span>
            <a class="btn ghost sm" routerLink="/ajustes/auditoria">Ver auditoría completa<nx-icon name="chevronRight" [size]="14" /></a>
          </div>
          @if (auditError()) {
            <p class="muted small" role="alert">No se pudo cargar la auditoría: {{ auditError() }}</p>
          } @else if (auditLoading()) {
            <p class="muted small">Cargando auditoría…</p>
          } @else if (audit().length) {
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Fecha</th><th>Acción</th><th>Resumen</th></tr></thead>
                <tbody>
                  @for (e of audit(); track e.id) {
                    <tr>
                      <td class="muted small nowrap">{{ dt(e.createdAt) }}</td>
                      <td><span class="badge primary">{{ accion(e.action) }}</span></td>
                      <td class="small">{{ e.resumen }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="muted small">Aún no hay cambios registrados sobre reglas de cumplimiento.</p>
          }
        </div>

        <p class="muted xsmall" style="margin-top:14px">
          Referencias de plantilla en las reglas se escriben con llaves, p. ej. {{ 'secrets.NOMBRE' | tpl }}.
        </p>
      }
    </div>
  `,
  styles: `
    .filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; margin-bottom: 16px; }
    .filters .field { display: flex; flex-direction: column; gap: 3px; }
    .filters .field .input { width: 150px; max-width: 100%; }
    .filters .field.grow { flex: 1; min-width: 180px; }
    .filters .field.grow .input { width: 100%; }
    .fs { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px 14px; margin: 0; display: flex; flex-direction: column; gap: 10px; }
    .fs legend { font-size: 12px; font-weight: 800; letter-spacing: .03em; text-transform: uppercase; color: var(--muted); padding: 0 6px; }
    .req { color: var(--danger); }
    .xsmall { font-size: 11px; }
    .num { text-align: right; }
    .num .btn { margin-left: 6px; }
    @media (max-width: 520px) {
      .filters .field, .filters .field .input { width: 100%; }
      .num { text-align: left; }
      .num .btn { margin: 4px 6px 0 0; }
    }
  `,
})
export class CumplimientoPage implements OnInit {
  private readonly api = inject(ComplianceApi);
  private readonly auditApi = inject(AuditApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly isAdmin = this.auth.isAdmin;
  readonly canEdit = this.auth.isAdmin;

  readonly niveles = NIVELES_RIESGO;
  readonly tipos = TIPOS_DATO;

  readonly reglas = signal<ReglaCumplimiento[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly toggling = signal<string | null>(null);
  readonly draft = signal<ReglaDraft | null>(null);

  readonly audit = signal<AuditEntry[]>([]);
  readonly auditLoading = signal(false);
  readonly auditError = signal<string | null>(null);

  // Filtros: objeto mutable enlazado con ngModel + tick para recomputar la lista visible.
  filtros: ReglaFiltros = { ...EMPTY_FILTROS };
  private readonly filtroTick = signal(0);

  readonly visibles = computed<ReglaCumplimiento[]>(() => {
    this.filtroTick();
    return filtrarReglas(this.reglas(), this.filtros);
  });
  readonly jurisdicciones = computed(() => valoresDistintos(this.reglas(), 'jurisdiccion'));
  readonly sectores = computed(() => valoresDistintos(this.reglas(), 'sector'));
  readonly procesos = computed(() => valoresDistintos(this.reglas(), 'proceso'));

  // Presentación (delegada en la lógica pura).
  readonly alcance = alcanceTexto;
  readonly nivelLabel = nivelRiesgoLabel;
  readonly tipoLabel = tipoDatoLabel;
  readonly obligatoria = esObligatoria;
  readonly validacion = reglaValidacionResumen;
  readonly accion = actionLabel;
  readonly dt = formatDateTime;

  ngOnInit() {
    if (!this.isAdmin()) {
      this.loading.set(false);
      return;
    }
    void this.load();
    void this.cargarAuditoria();
  }

  onFiltro() {
    this.filtroTick.update((n) => n + 1);
  }

  hayFiltros(): boolean {
    this.filtroTick();
    return hayFiltrosActivos(this.filtros);
  }

  limpiar() {
    this.filtros = { ...EMPTY_FILTROS };
    this.onFiltro();
  }

  resumenConteo(): string {
    const total = this.reglas().length;
    const activas = this.reglas().filter((r) => r.activa).length;
    const vis = this.visibles().length;
    return `${vis} de ${total} ${total === 1 ? 'regla' : 'reglas'} · ${activas} ${activas === 1 ? 'activa' : 'activas'}.`;
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.reglas.set(await this.api.rules());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  private async cargarAuditoria() {
    this.auditLoading.set(true);
    this.auditError.set(null);
    try {
      const page = await this.auditApi.listar({ targetType: 'ReglaCumplimiento' }, { take: 20 });
      this.audit.set(page.items);
    } catch (e) {
      this.auditError.set(errorMessage(e));
    } finally {
      this.auditLoading.set(false);
    }
  }

  nueva() {
    if (!this.canEdit()) return;
    this.draft.set(nuevoDraft());
  }

  editar(r: ReglaCumplimiento) {
    this.draft.set(draftDeRegla(r));
  }

  async save() {
    const d = this.draft();
    if (!d) return;
    const motivo = validarDraft(d);
    if (motivo) {
      this.toast.error(motivo);
      return;
    }
    const body = draftAInput(d);
    this.saving.set(true);
    try {
      if (d.id) {
        await this.api.updateRule(d.id, body);
        this.toast.success('Regla actualizada');
      } else {
        await this.api.createRule(body);
        this.toast.success('Regla creada (nace inactiva hasta que la active)');
      }
      this.draft.set(null);
      await this.load();
      await this.cargarAuditoria();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  async alternar(r: ReglaCumplimiento) {
    const activar = !r.activa;
    const msg = activar
      ? '¿Activar esta regla? Es ASESORA (no bloqueante): se tendrá en cuenta al resolver y evaluar, pero no bloquea ninguna operación.'
      : '¿Inactivar esta regla? Dejará de considerarse al resolver y evaluar.';
    if (!confirm(msg)) return;
    this.toggling.set(r.id);
    try {
      await this.api.updateRule(r.id, { activa: activar });
      this.toast.success(activar ? 'Regla activada (asesora)' : 'Regla inactivada');
      await this.load();
      await this.cargarAuditoria();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.toggling.set(null);
    }
  }

  async eliminar(r: ReglaCumplimiento) {
    if (!confirm(`¿Eliminar la regla "${r.campoClave}"? Esta acción queda auditada y no se puede deshacer.`)) return;
    try {
      await this.api.deleteRule(r.id);
      this.toast.success('Regla eliminada');
      await this.load();
      await this.cargarAuditoria();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
