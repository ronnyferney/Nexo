import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ResultsApi } from '../../core/results.api';
import { ToastService } from '../../core/toast.service';
import type { EstadoResultado, ModoValidacion, TareaDetalle, TipoResultado } from '../../core/results.models';
import { IconComponent } from '../../shared/icon.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { EvidenciasListComponent } from './evidencias-list.component';
import { ValidacionesListComponent } from './validaciones-list.component';
import { PasaportePanelComponent } from './pasaporte-panel.component';
import {
  avancesResultado,
  estadoResultadoMeta,
  puedeComprometer,
  puedeValidar,
  resultadoAceptado,
  resultadoGeneradoNoAceptado,
  TIPO_RESULTADO_META,
} from './trabajo.util';

type Formulario = 'none' | 'contrato' | 'evidencia' | 'verificar';

/**
 * Panel del RESULTADO (RF29/RF30/RF31): el contrato (resultado esperado, criterio, evidencia exigida, versión), su
 * estado verificable —diferenciado del estado operativo—, la evidencia adjunta y quién verificó. Concentra las
 * acciones del resultado: crear/comprometer/avanzar/verificar y agregar evidencia (solo con permiso de edición).
 * Distingue «resultado generado» de «resultado ACEPTADO» (HU15): un entregable no basta hasta que la verificación lo acepta.
 */
@Component({
  selector: 'nx-contrato-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    IconComponent,
    EmptyStateComponent,
    EvidenciasListComponent,
    ValidacionesListComponent,
    PasaportePanelComponent,
  ],
  template: `
    <section class="card resultado">
      <header class="card-title">
        <nx-icon name="target" [size]="18" />
        <h2>Resultado</h2>
        @if (contrato(); as c) {
          <span class="badge {{ meta(c.estado).badge }}">{{ meta(c.estado).label }}</span>
          <span class="badge {{ tipoMeta(c.tipoResultado).badge }}">{{ tipoMeta(c.tipoResultado).label }}</span>
          <span class="badge">v{{ c.version }}</span>
        }
      </header>

      @if (contrato(); as c) {
        <!-- Distinción explícita generado vs aceptado (HU15). -->
        @if (aceptado()) {
          <p class="estado-nota ok" role="status">
            <nx-icon name="checkCircle" [size]="15" />Resultado verificado y <strong>ACEPTADO</strong> por alguien
            distinto del ejecutor.
          </p>
        } @else if (generado()) {
          <p class="estado-nota pend" role="status">
            <nx-icon name="info" [size]="15" />El resultado fue <strong>generado</strong> pero aún no está aceptado:
            falta la verificación (ejecutado ≠ aceptado).
          </p>
        }

        <dl class="campos">
          <dt>Resultado esperado</dt>
          <dd>{{ c.resultadoEsperado }}</dd>
          @if (c.alcance) {
            <dt>Alcance</dt>
            <dd>{{ c.alcance }}</dd>
          }
          @if (c.indicador) {
            <dt>Indicador</dt>
            <dd>{{ c.indicador }}</dd>
          }
          <dt>Evidencia exigida</dt>
          <dd>
            @if (c.evidenciaExigida.length) {
              @for (t of c.evidenciaExigida; track t) {
                <span class="badge" [class.success]="tiposPresentes().has(t)">{{ t }}</span>
              }
            } @else {
              <span class="muted">Sin tipos de evidencia obligatorios</span>
            }
          </dd>
        </dl>

        @if (canEdit()) {
          <div class="acciones">
            @if (comprometer()) {
              <button class="btn" [disabled]="busy()" (click)="hacer('comprometer')">
                <nx-icon name="check" [size]="15" />Comprometer
              </button>
            }
            @for (a of avances(); track a) {
              <button class="btn" [disabled]="busy()" (click)="avanzar(a)">
                <nx-icon name="play" [size]="15" />{{ a === 'EN_PRODUCCION' ? 'A producción' : 'Presentar para validación' }}
              </button>
            }
            @if (validar()) {
              <button class="btn primary" [disabled]="busy()" (click)="abrir('verificar')">
                <nx-icon name="shield" [size]="15" />Verificar resultado
              </button>
            }
            <button class="btn" [disabled]="busy()" (click)="abrir('evidencia')">
              <nx-icon name="plus" [size]="15" />Agregar evidencia
            </button>
          </div>
        }
      } @else {
        <nx-empty-state
          icon="target"
          title="Sin contrato de resultado"
          description="Define el resultado esperado como objeto verificable; una descripción libre no lo reemplaza (RF29).">
          @if (canEdit()) {
            <div class="empty-actions">
              <button class="btn primary" (click)="abrir('contrato')">
                <nx-icon name="plus" [size]="16" />Crear contrato
              </button>
            </div>
          }
        </nx-empty-state>
      }

      <!-- Formularios -->
      @if (form() === 'contrato') {
        <form class="mini" (ngSubmit)="crearContrato()">
          <div class="field">
            <label for="re">Resultado esperado</label>
            <textarea id="re" class="input" rows="2" [(ngModel)]="fResultado" name="re" required></textarea>
          </div>
          <div class="row">
            <div class="field">
              <label for="tipo">Tipo</label>
              <select id="tipo" class="input" [(ngModel)]="fTipo" name="tipo">
                <option value="RESULTADO_NEGOCIO">Resultado de negocio</option>
                <option value="PRODUCTO_INTERMEDIO">Producto intermedio</option>
              </select>
            </div>
            <div class="field">
              <label for="ev">Evidencia exigida (separada por comas)</label>
              <input id="ev" class="input" [(ngModel)]="fEvidencia" name="ev" placeholder="pago_confirmado, conciliacion" />
            </div>
          </div>
          <div class="acciones">
            <button type="submit" class="btn primary" [disabled]="busy() || !fResultado().trim()">Crear</button>
            <button type="button" class="btn ghost" (click)="cerrar()">Cancelar</button>
          </div>
        </form>
      }

      @if (form() === 'evidencia') {
        <form class="mini" (ngSubmit)="agregarEvidencia()">
          <div class="row">
            <div class="field">
              <label for="et">Tipo</label>
              <input id="et" class="input" [(ngModel)]="eTipo" name="et" required />
            </div>
            <div class="field">
              <label for="eu">Enlace a la fuente (opcional)</label>
              <input id="eu" class="input" [(ngModel)]="eUrl" name="eu" placeholder="https://…" />
            </div>
          </div>
          <div class="field">
            <label for="ed">Descripción (opcional)</label>
            <input id="ed" class="input" [(ngModel)]="eDesc" name="ed" />
          </div>
          <div class="acciones">
            <button type="submit" class="btn primary" [disabled]="busy() || !eTipo().trim()">Adjuntar</button>
            <button type="button" class="btn ghost" (click)="cerrar()">Cancelar</button>
          </div>
        </form>
      }

      @if (form() === 'verificar') {
        <form class="mini" (ngSubmit)="verificar()">
          <div class="field">
            <label for="modo">Modo de verificación</label>
            <select id="modo" class="input" [(ngModel)]="vModo" name="modo">
              <option value="HUMANA">Humana (una persona acepta o devuelve)</option>
              <option value="DETERMINISTA">Determinista (evalúa la regla y la evidencia)</option>
            </select>
            <p class="hint">El verificador debe ser distinto del ejecutor del resultado (RF30).</p>
          </div>
          @if (vModo() === 'HUMANA') {
            <div class="field">
              <label for="ver">Veredicto</label>
              <select id="ver" class="input" [(ngModel)]="vVeredicto" name="ver">
                <option value="ACEPTA">Aceptar</option>
                <option value="DEVUELVE">Devolver</option>
              </select>
            </div>
            <div class="field">
              <label for="mot">Motivo {{ vVeredicto() === 'DEVUELVE' ? '(obligatorio al devolver)' : '(opcional)' }}</label>
              <input id="mot" class="input" [(ngModel)]="vMotivo" name="mot" />
            </div>
          }
          <div class="acciones">
            <button type="submit" class="btn primary" [disabled]="busy()">Verificar</button>
            <button type="button" class="btn ghost" (click)="cerrar()">Cancelar</button>
          </div>
        </form>
      }

      <div class="bloque">
        <h3>Evidencia</h3>
        <nx-evidencias-list [evidencias]="tarea().evidencias" [exigidos]="contrato()?.evidenciaExigida ?? []" />
      </div>
      <div class="bloque">
        <h3>Verificaciones</h3>
        <nx-validaciones-list [validaciones]="contrato()?.validaciones ?? []" />
      </div>

      @if (contrato(); as c) {
        @if (aceptado()) {
          <nx-pasaporte-panel [contratoId]="c.id" [estado]="c.estado" [canEdit]="canEdit()" />
        }
      }
    </section>
  `,
  styles: `
    .resultado { display: flex; flex-direction: column; gap: 14px; }
    .card-title { flex-wrap: wrap; }
    .card-title h2 { font-size: 16px; margin: 0; flex: 1; }
    .estado-nota { display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 10px 12px; border-radius: 9px; font-size: 13px; }
    .estado-nota.ok { background: var(--success-50); color: var(--success); }
    .estado-nota.pend { background: var(--warning-50); color: var(--warning); }
    .campos { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; }
    .campos dt { color: var(--muted); font-size: 12.5px; font-weight: 600; }
    .campos dd { margin: 0; font-size: 13.5px; display: flex; flex-wrap: wrap; gap: 6px; }
    .acciones { display: flex; flex-wrap: wrap; gap: 8px; }
    .mini { display: flex; flex-direction: column; gap: 10px; background: var(--surface-2); padding: 14px; border-radius: 10px; }
    .mini .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .bloque h3 { font-size: 13px; color: var(--muted); margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.04em; }
    @media (max-width: 560px) { .campos { grid-template-columns: 1fr; gap: 2px 0; } .mini .row { grid-template-columns: 1fr; } }
  `,
})
export class ContratoPanelComponent {
  private readonly api = inject(ResultsApi);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  readonly tarea = input.required<TareaDetalle>();
  readonly canEdit = input(false);
  readonly changed = output<void>();

  protected readonly contrato = computed(() => this.tarea().contratoResultado);
  protected readonly busy = signal(false);
  protected readonly form = signal<Formulario>('none');

  protected readonly aceptado = computed(() => resultadoAceptado(this.contrato()?.estado));
  protected readonly generado = computed(() => resultadoGeneradoNoAceptado(this.contrato()?.estado));
  protected readonly comprometer = computed(() => {
    const e = this.contrato()?.estado;
    return !!e && puedeComprometer(e);
  });
  protected readonly avances = computed(() => {
    const e = this.contrato()?.estado;
    return e ? avancesResultado(e) : [];
  });
  protected readonly validar = computed(() => {
    const e = this.contrato()?.estado;
    return !!e && puedeValidar(e);
  });
  protected readonly tiposPresentes = computed(() => new Set(this.tarea().evidencias.map((e) => e.tipo)));

  // Formulario: contrato
  protected readonly fResultado = signal('');
  protected readonly fTipo = signal<TipoResultado>('RESULTADO_NEGOCIO');
  protected readonly fEvidencia = signal('');
  // Formulario: evidencia
  protected readonly eTipo = signal('');
  protected readonly eUrl = signal('');
  protected readonly eDesc = signal('');
  // Formulario: verificar
  protected readonly vModo = signal<ModoValidacion>('HUMANA');
  protected readonly vVeredicto = signal<'ACEPTA' | 'DEVUELVE'>('ACEPTA');
  protected readonly vMotivo = signal('');

  protected meta(e: EstadoResultado) {
    return estadoResultadoMeta(e);
  }
  protected tipoMeta(t: TipoResultado) {
    return TIPO_RESULTADO_META[t];
  }

  protected abrir(f: Formulario) {
    this.form.set(f);
  }
  protected cerrar() {
    this.form.set('none');
  }

  private async run(fn: () => Promise<unknown>, ok: string) {
    this.busy.set(true);
    try {
      await fn();
      this.toast.success(ok);
      this.cerrar();
      this.changed.emit();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected hacer(accion: 'comprometer') {
    const id = this.contrato()?.id;
    if (!id) return;
    if (accion === 'comprometer') void this.run(() => this.api.comprometerContrato(id), 'Contrato comprometido');
  }

  protected avanzar(estado: 'EN_PRODUCCION' | 'PENDIENTE_VALIDACION') {
    const id = this.contrato()?.id;
    if (!id) return;
    void this.run(() => this.api.avanzarContrato(id, estado), 'Resultado actualizado');
  }

  protected crearContrato() {
    const resultadoEsperado = this.fResultado().trim();
    if (!resultadoEsperado) return;
    const evidenciaExigida = this.fEvidencia()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    void this.run(
      () =>
        this.api.crearContrato(this.tarea().id, {
          resultadoEsperado,
          tipoResultado: this.fTipo(),
          evidenciaExigida,
        }),
      'Contrato de resultado creado',
    );
    this.fResultado.set('');
    this.fEvidencia.set('');
  }

  protected agregarEvidencia() {
    const id = this.contrato()?.id;
    const tipo = this.eTipo().trim();
    if (!tipo) return;
    const url = this.eUrl().trim();
    const data = { tipo, descripcion: this.eDesc().trim() || null, referencia: url ? { url } : {} };
    const req = id ? this.api.agregarEvidenciaContrato(id, data) : this.api.agregarEvidenciaTarea(this.tarea().id, data);
    void this.run(() => req, 'Evidencia adjunta');
    this.eTipo.set('');
    this.eUrl.set('');
    this.eDesc.set('');
  }

  protected verificar() {
    const id = this.contrato()?.id;
    if (!id) return;
    const modo = this.vModo();
    const data =
      modo === 'HUMANA'
        ? {
            modo,
            validadorUserId: this.auth.me()?.id ?? undefined,
            veredicto: this.vVeredicto(),
            motivo: this.vMotivo().trim() || undefined,
          }
        : { modo };
    this.busy.set(true);
    this.api
      .validarContrato(id, data)
      .then((r) => {
        if (r.estadoResultado === 'ACEPTADO') this.toast.success('Resultado aceptado');
        else if (r.estadoResultado === 'DEVUELTO_INCUMPLIDO')
          this.toast.error(`Resultado devuelto${r.validacion.motivo ? `: ${r.validacion.motivo}` : ''}`);
        else if (r.requiereRevisionHumana)
          this.toast.info('Verificación registrada; requiere revisión humana antes de aceptar');
        else this.toast.info('Verificación registrada');
        this.cerrar();
        this.changed.emit();
      })
      .catch((e) => this.toast.error(errorMessage(e)))
      .finally(() => this.busy.set(false));
  }
}
