import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.service';
import { EstructuraApi } from '../../core/estructura.api';
import { ImputacionApi } from '../../core/imputacion.api';
import type { ServicioInterno } from '../../core/imputacion.models';
import type { CentroCosto, LineaNegocio } from '../../core/estructura.models';
import type { OrgUnit } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import {
  construirReparto,
  imputacionesAFilas,
  nuevaFila,
  periodoActual,
  periodoLabel,
  repartoCuadra,
  sumaPorcentajes,
  TIPOS_DESTINO,
  tipoDestinoLabel,
  validarRepartoUI,
  type FilaReparto,
} from './imputacion.util';
import type { TipoDestino } from '../../core/imputacion.models';

/**
 * Editor del reparto de costo de un servicio compartido (ADR 0011 D5 · E9 · RF45). El reparto se define por periodo
 * mensual y DEBE sumar 100 %: la suma se resalta en rojo si no cuadra y no deja guardar. Cada fila elige un destino
 * (línea / área / centro de costo) de la empresa del servicio. Solo EDITOR+ puede guardar o borrar (gate real en el
 * backend). El reparto es de REPORTE: no toca presupuestos ni reservas (ADR 0002).
 */
@Component({
  selector: 'nx-editor-reparto',
  imports: [FormsModule, IconComponent, LoadingStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card stack editor" style="margin-bottom:16px">
      <div class="card-title">
        <nx-icon name="scale" />
        <h2>Reparto de «{{ servicio().nombre }}»</h2>
        <span class="spacer"></span>
        <button class="btn ghost icon" title="Cerrar" aria-label="Cerrar el editor de reparto" (click)="closed.emit()"><nx-icon name="x" /></button>
      </div>

      <div class="callout info">
        <nx-icon name="info" [size]="16" />
        <span>El reparto distribuye el costo medido del área dueña entre los destinos. Es de reporte: suma 100 % y no toca presupuestos ni reservas.</span>
      </div>

      <div class="row wrap" style="align-items:flex-end">
        <div class="field" style="min-width:200px">
          <label for="rp-periodo">Periodo (mensual)</label>
          <input id="rp-periodo" class="input" type="month" [ngModel]="periodo()" (ngModelChange)="onPeriodo($event)" />
          <span class="hint">{{ periodoLabel(periodo()) }}</span>
        </div>
      </div>

      @if (loading()) {
        <nx-loading-state text="Cargando el reparto…" />
      } @else {
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th style="width:150px">Tipo</th><th>Destino</th><th class="num" style="width:140px">Porcentaje</th><th style="width:44px"></th></tr></thead>
            <tbody>
              @for (f of filas(); track $index; let i = $index) {
                <tr>
                  <td>
                    <select class="input" [ngModel]="f.tipo" [disabled]="!canEdit()" aria-label="Tipo de destino" (ngModelChange)="setTipo(i, $event)">
                      @for (t of tipos; track t) { <option [value]="t">{{ tipoDestinoLabel(t) }}</option> }
                    </select>
                  </td>
                  <td>
                    <select class="input" [ngModel]="f.destinoId" [disabled]="!canEdit()" aria-label="Destino del reparto"
                      [class.invalid]="!f.destinoId" (ngModelChange)="setDestino(i, $event)">
                      <option value="">— Elija un destino —</option>
                      @for (o of opcionesDe(f.tipo); track o.id) { <option [value]="o.id">{{ o.label }}</option> }
                    </select>
                  </td>
                  <td class="num">
                    <input class="input num" type="number" min="0" max="100" step="0.01" [ngModel]="f.porcentaje" [disabled]="!canEdit()"
                      aria-label="Porcentaje del destino" [class.invalid]="!(f.porcentaje && f.porcentaje > 0 && f.porcentaje <= 100)"
                      (ngModelChange)="setPorcentaje(i, $event)" />
                  </td>
                  <td class="num">
                    @if (canEdit()) {
                      <button class="btn ghost icon sm danger" title="Quitar fila" aria-label="Quitar fila del reparto" (click)="removeFila(i)"><nx-icon name="x" [size]="15" /></button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="4" class="muted small" style="padding:14px">Este periodo aún no tiene reparto. Agregue destinos hasta sumar 100 %.</td></tr>
              }
            </tbody>
            <tfoot>
              <tr [class.bad]="!cuadra()">
                <td colspan="2" class="num"><strong>Suma</strong></td>
                <td class="num"><strong [class.error-text]="!cuadra()">{{ suma().toFixed(2) }} %</strong></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        @if (canEdit()) {
          <div class="row wrap">
            <button class="btn sm" (click)="addFila()"><nx-icon name="plus" [size]="14" />Agregar destino</button>
            <span class="spacer"></span>
            @if (!cuadra()) {
              <span class="badge danger" role="status"><nx-icon name="alert" [size]="14" />Falta {{ (100 - suma()).toFixed(2) }} % para cuadrar</span>
            } @else if (filas().length) {
              <span class="badge success"><nx-icon name="check" [size]="14" />Suma 100 %</span>
            }
          </div>

          @if (mensaje()) { <p class="error-text" role="alert">{{ mensaje() }}</p> }

          <div class="row">
            @if (tieneReparto()) {
              <button class="btn ghost danger" [disabled]="busy()" (click)="eliminar()"><nx-icon name="trash" [size]="15" />Borrar reparto del periodo</button>
            }
            <span class="spacer"></span>
            <button class="btn" (click)="closed.emit()">Cerrar</button>
            <button class="btn primary" [disabled]="busy() || !valido()" (click)="guardar()"><nx-icon name="save" />Guardar reparto</button>
          </div>
        } @else {
          <p class="muted small">Necesita permisos de edición para modificar el reparto.</p>
        }
      }
    </div>
  `,
  styles: `
    .input.invalid { border-color: var(--danger); box-shadow: 0 0 0 2px var(--danger-50); }
    tfoot tr.bad td { color: var(--danger); }
    .table tfoot td { border-top: 2px solid var(--border); }
  `,
})
export class EditorRepartoComponent implements OnInit {
  private readonly imputacion = inject(ImputacionApi);
  private readonly estructura = inject(EstructuraApi);
  private readonly toast = inject(ToastService);

  readonly servicio = input.required<ServicioInterno>();
  readonly areas = input.required<OrgUnit[]>();
  readonly canEdit = input<boolean>(false);
  readonly closed = output<void>();

  readonly tipos = TIPOS_DESTINO;
  readonly tipoDestinoLabel = tipoDestinoLabel;
  readonly periodoLabel = periodoLabel;

  readonly periodo = signal<string>(periodoActual());
  readonly filas = signal<FilaReparto[]>([]);
  readonly lineas = signal<LineaNegocio[]>([]);
  readonly centros = signal<CentroCosto[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  /** `true` si el periodo tenía reparto guardado (para ofrecer «borrar»). */
  readonly tieneReparto = signal(false);

  readonly suma = computed(() => sumaPorcentajes(this.filas()));
  readonly cuadra = computed(() => repartoCuadra(this.filas()));
  readonly validacion = computed(() => validarRepartoUI(this.filas()));
  readonly valido = computed(() => this.validacion().ok);
  readonly mensaje = computed(() => (this.filas().length ? this.validacion().mensaje : ''));

  ngOnInit() {
    void this.loadCatalogos();
    void this.loadReparto();
  }

  private async loadCatalogos() {
    const empresaId = this.servicio().empresaId;
    const [lineas, centros] = await Promise.all([
      this.estructura.lineas(empresaId).catch(() => [] as LineaNegocio[]),
      this.estructura.centros(empresaId).catch(() => [] as CentroCosto[]),
    ]);
    this.lineas.set(lineas);
    this.centros.set(centros);
  }

  async loadReparto() {
    this.loading.set(true);
    try {
      const imps = await this.imputacion.reparto(this.servicio().id, this.periodo());
      this.tieneReparto.set(imps.length > 0);
      this.filas.set(imputacionesAFilas(imps));
    } catch (e) {
      this.toast.error(errorMessage(e));
      this.filas.set([]);
      this.tieneReparto.set(false);
    } finally {
      this.loading.set(false);
    }
  }

  onPeriodo(v: string) {
    if (!v) return;
    this.periodo.set(v);
    void this.loadReparto();
  }

  opcionesDe(tipo: TipoDestino): { id: string; label: string }[] {
    if (tipo === 'linea') return this.lineas().map((l) => ({ id: l.id, label: `${l.codigo} · ${l.nombre}` }));
    if (tipo === 'area') return this.areas().map((a) => ({ id: a.id, label: a.name }));
    return this.centros().map((c) => ({ id: c.id, label: `${c.codigo} · ${c.nombre}` }));
  }

  addFila() {
    this.filas.update((f) => [...f, nuevaFila()]);
  }

  removeFila(i: number) {
    this.filas.update((f) => f.filter((_, j) => j !== i));
  }

  setTipo(i: number, tipo: TipoDestino) {
    this.filas.update((f) => f.map((row, j) => (j === i ? { ...row, tipo, destinoId: '' } : row)));
  }

  setDestino(i: number, destinoId: string) {
    this.filas.update((f) => f.map((row, j) => (j === i ? { ...row, destinoId } : row)));
  }

  setPorcentaje(i: number, value: number | null) {
    const porcentaje = value === null || Number.isNaN(value) ? null : Number(value);
    this.filas.update((f) => f.map((row, j) => (j === i ? { ...row, porcentaje } : row)));
  }

  async guardar() {
    if (!this.valido()) return;
    this.busy.set(true);
    try {
      await this.imputacion.setReparto(this.servicio().id, construirReparto(this.periodo(), this.filas()));
      this.toast.success('Reparto guardado');
      this.tieneReparto.set(true);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async eliminar() {
    if (!confirm(`¿Borrar el reparto de "${this.servicio().nombre}" para ${periodoLabel(this.periodo())}?`)) return;
    this.busy.set(true);
    try {
      await this.imputacion.deleteReparto(this.servicio().id, this.periodo());
      this.toast.success('Reparto borrado');
      this.filas.set([]);
      this.tieneReparto.set(false);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
