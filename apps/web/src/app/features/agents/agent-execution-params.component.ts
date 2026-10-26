import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { ExecutionParamsApi } from '../../core/execution-params.api';
import type { EstacionVirtual, ParametrosEjecucion } from '../../core/execution-params.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { AgentSectionComponent } from './agent-section.component';
import {
  estacionLabel,
  estacionesSeleccionables,
  formatParametrosJson,
  parseParametrosJson,
  salidaInternetResumen,
} from './execution-params.util';

/**
 * Pestaña «Ejecución» del detalle del agente (E8): estación virtual asignada, gate de salida a internet y parámetros
 * de ejecución extensibles (JSON). Lee y guarda por la fachada `ExecutionParamsApi`; editar exige EDITOR+ (`canEdit`),
 * un VIEWER lo ve en solo lectura. Autónoma del formulario principal del agente: carga, guarda y recarga su propio
 * estado.
 */
@Component({
  selector: 'nx-agent-execution-params',
  imports: [FormsModule, RouterLink, IconComponent, AgentSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <div class="card empty"><p>Cargando parámetros de ejecución…</p></div>
    } @else if (error()) {
      <div class="card empty" role="alert">
        <nx-icon name="alert" [size]="28" /><h3>No se pudieron cargar los parámetros</h3><p>{{ error() }}</p>
        <button class="btn" (click)="load()">Reintentar</button>
      </div>
    } @else {
      <div class="stack">
        <nx-agent-section icon="server" title="Estación virtual" status="optional"
          description="Estación de trabajo (máquina real o lógica) donde opera el empleado digital. El proveedor es solo una etiqueta; nunca guarda credenciales.">
          <div class="field">
            <label for="ep-estacion">Estación asignada</label>
            <select id="ep-estacion" class="input" [disabled]="!canEdit()" [ngModel]="estacionId()" (ngModelChange)="estacionId.set($event)">
              <option [ngValue]="null">Sin estación asignada</option>
              @for (e of estacionesOptions(); track e.id) {
                <option [ngValue]="e.id">{{ label(e) }}{{ e.estado === 'ACTIVA' ? '' : ' (' + e.estado.toLowerCase() + ')' }}</option>
              }
            </select>
            @if (estacionesOptions().length === 0) {
              <span class="hint">No hay estaciones activas. Un administrador puede crearlas en <a routerLink="/admin/estaciones-virtuales">Estaciones virtuales</a>.</span>
            } @else {
              <span class="hint">Gestionar estaciones en <a routerLink="/admin/estaciones-virtuales">Estaciones virtuales</a> (requiere administrador).</span>
            }
          </div>
        </nx-agent-section>

        <nx-agent-section icon="globe" title="Salida a internet" [status]="salida() ? 'complete' : 'optional'"
          [statusLabel]="salida() ? 'Habilitada' : 'Desactivada'"
          description="Controla si el empleado digital puede hacer llamadas salientes a internet.">
          <label class="salida-row">
            <span class="switch">
              <input type="checkbox" role="switch" [checked]="salida()" [disabled]="!canEdit()"
                aria-label="Permitir salida a internet" (change)="salida.set($any($event.target).checked)" />
              <span></span>
            </span>
            <span class="salida-text">
              <strong>Permitir salida a internet</strong>
              <span class="muted small block">{{ resumen() }}</span>
            </span>
          </label>
          <div class="callout info" role="note">
            <nx-icon name="shield" [size]="16" />
            <span class="small">Permitir la salida a internet <strong>no</strong> abre acceso irrestricto: toda llamada
              saliente sigue pasando por el control de seguridad (SSRF / allowlist, tiempo y tamaño). Con el interruptor
              desactivado, el agente no puede salir a internet.</span>
          </div>
        </nx-agent-section>

        <nx-agent-section icon="settings" title="Parámetros avanzados" status="optional"
          description="Parámetros de ejecución extensibles en formato JSON, por ejemplo horario de operación o límites de uso.">
          <div class="field">
            <label for="ep-params">Parámetros (JSON)</label>
            <textarea id="ep-params" class="input code" rows="8" spellcheck="false" [disabled]="!canEdit()"
              [attr.aria-invalid]="paramsError() ? 'true' : null" [attr.aria-describedby]="paramsError() ? 'ep-params-error' : 'ep-params-hint'"
              [ngModel]="paramsText()" (ngModelChange)="paramsText.set($event)"></textarea>
            @if (paramsError(); as err) {
              <span id="ep-params-error" class="field-error" role="alert"><nx-icon name="alert" [size]="12" />{{ err }}</span>
            } @else {
              <span id="ep-params-hint" class="hint">Un objeto JSON. Ejemplo: <code>{{ ejemplo }}</code></span>
            }
          </div>
        </nx-agent-section>

        @if (canEdit()) {
          <div class="row wrap actions">
            @if (dirty()) { <span class="badge warning" role="status">Cambios sin guardar</span> }
            <span class="spacer"></span>
            <button class="btn" [disabled]="saving() || !dirty()" (click)="reset()">Descartar</button>
            <button class="btn primary" [disabled]="saving() || !dirty() || !!paramsError()" (click)="save()">
              <nx-icon name="save" [size]="16" />{{ saving() ? 'Guardando…' : 'Guardar parámetros' }}
            </button>
          </div>
        } @else {
          <div class="callout info ro-note" role="note"><nx-icon name="eye" [size]="16" />
            <span class="small">Vista de solo lectura: necesita permiso de edición sobre el agente para cambiar estos parámetros.</span></div>
        }
      </div>
    }
  `,
  styles: `
    .salida-row { display: flex; align-items: flex-start; gap: 12px; cursor: pointer; }
    .salida-text { display: flex; flex-direction: column; gap: 2px; }
    .actions { align-items: center; gap: 8px; }
    .spacer { flex: 1; }
    code { background: var(--surface-2); padding: 0 6px; border-radius: 6px; }
    textarea.code { font-family: var(--mono, monospace); font-size: 13px; }
  `,
})
export class AgentExecutionParamsComponent implements OnInit {
  private readonly api = inject(ExecutionParamsApi);
  private readonly toast = inject(ToastService);

  readonly agentId = input.required<string>();
  readonly canEdit = input(false);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly estaciones = signal<EstacionVirtual[]>([]);

  readonly estacionId = signal<string | null>(null);
  readonly salida = signal(false);
  readonly paramsText = signal('{}');

  /** Instantánea guardada (signal, para que `dirty` recalcule al guardar), para detectar cambios y habilitar «Guardar». */
  private readonly snapshot = signal({ estacionId: null as string | null, salida: false, params: '{}' });

  readonly ejemplo = '{ "horarioOperacion": "L-V 9-18", "maxEjecucionesDiarias": 100 }';
  readonly label = estacionLabel;
  readonly resumen = computed(() => salidaInternetResumen(this.salida()));

  readonly estacionesOptions = computed(() => estacionesSeleccionables(this.estaciones(), this.estacionId()));

  /** Mensaje de error del JSON de parámetros (null si es válido). */
  readonly paramsError = computed(() => parseParametrosJson(this.paramsText()).error ?? null);

  /** Instantánea comparable del estado actual (el JSON se normaliza cuando es válido). */
  private currentSnapshot() {
    const parsed = parseParametrosJson(this.paramsText());
    return {
      estacionId: this.estacionId(),
      salida: this.salida(),
      params: parsed.error ? this.paramsText() : JSON.stringify(parsed.value ?? {}),
    };
  }

  readonly dirty = computed(() => {
    const cur = this.currentSnapshot();
    const snap = this.snapshot();
    return cur.estacionId !== snap.estacionId || cur.salida !== snap.salida || cur.params !== snap.params;
  });

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [params, estaciones] = await Promise.all([
        this.api.parametros(this.agentId()),
        this.api.estaciones().catch(() => [] as EstacionVirtual[]),
      ]);
      this.estaciones.set(estaciones);
      this.apply(params);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  private apply(p: ParametrosEjecucion) {
    this.estacionId.set(p.estacionVirtualId ?? null);
    this.salida.set(p.salidaInternet);
    this.paramsText.set(formatParametrosJson(p.parametrosEjecucion));
    this.snapshot.set({
      estacionId: p.estacionVirtualId ?? null,
      salida: p.salidaInternet,
      params: JSON.stringify(p.parametrosEjecucion ?? {}),
    });
  }

  /** Descarta los cambios sin guardar y vuelve al último estado guardado. */
  reset() {
    const snap = this.snapshot();
    this.estacionId.set(snap.estacionId);
    this.salida.set(snap.salida);
    this.paramsText.set(formatParametrosJson(snap.params ? JSON.parse(snap.params) : {}));
  }

  async save() {
    if (!this.canEdit() || this.saving()) return;
    const parsed = parseParametrosJson(this.paramsText());
    if (parsed.error) {
      this.toast.error(parsed.error);
      return;
    }
    this.saving.set(true);
    try {
      const updated = await this.api.guardarParametros(this.agentId(), {
        estacionVirtualId: this.estacionId(),
        salidaInternet: this.salida(),
        parametrosEjecucion: parsed.value,
      });
      this.apply(updated);
      this.toast.success('Parámetros de ejecución guardados');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
