import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ExcepcionesApi } from '../../core/excepciones.api';
import type {
  ClaseFallo,
  Excepcion,
  ExcepcionDetalle,
  OrigenExcepcion,
  ResultadoConciliacion,
} from '../../core/excepciones.models';
import { CLASES_FALLO, ESTADOS_EXCEPCION, ORIGENES_EXCEPCION } from '../../core/excepciones.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import {
  type AccionExcepcion,
  CLASE_META,
  conciliacion,
  ESTADO_META,
  EVENTO_META,
  filtrarBandeja,
  ORIGEN_META,
  ordenarBandeja,
  puedeAccion,
} from './excepciones.util';

/** Panel de acción abierto en el detalle (formularios que piden datos). */
type PanelAccion = 'info' | 'reasignar' | 'cancelar' | 'conciliar';

/**
 * Bandeja de excepciones (E7 · RF20/RF21). Lista con filtros (estado, clase, origen, tarea) ordenada por atención y
 * antigüedad, y un detalle en cajón con el historial append-only y las acciones operativas según permiso.
 */
@Component({
  selector: 'nx-excepciones',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, RelativeTimePipe],
  templateUrl: './excepciones.page.html',
  styles: `
    .drawer-backdrop { position: fixed; inset: 0; background: rgba(8, 16, 45, 0.45); z-index: 40; }
    .drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(720px, 100vw); background: var(--bg); border-left: 1px solid var(--border); box-shadow: var(--shadow); z-index: 41; display: flex; flex-direction: column; }
    .drawer-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 20px; border-bottom: 1px solid var(--border); }
    .drawer-head h2 { margin: 0; font-size: 18px; word-break: break-word; }
    .drawer-body { overflow-y: auto; padding: 18px 20px; }
    .kv { display: grid; grid-template-columns: 150px 1fr; gap: 8px 12px; align-items: start; }
    .kv .k, .k { font-size: 12.5px; font-weight: 600; color: var(--muted); }
    .kv .v { min-width: 0; word-break: break-word; }
    pre.code-block { margin: 4px 0 0; white-space: pre-wrap; word-break: break-word; max-height: 240px; overflow: auto; }
    .timeline { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 0; }
    .timeline li { display: grid; grid-template-columns: 26px 1fr; gap: 10px; padding-bottom: 14px; position: relative; }
    .timeline li:not(:last-child)::before { content: ''; position: absolute; left: 12px; top: 26px; bottom: 0; width: 2px; background: var(--border); }
    .timeline .dot-icon { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--surface-2, var(--bg)); border: 1px solid var(--border); color: var(--muted); }
    .timeline .ev-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .action-tabs { display: flex; flex-wrap: wrap; gap: 8px; }
    @media (max-width: 640px) { .kv { grid-template-columns: 1fr; gap: 2px 0; } }
  `,
})
export class ExcepcionesPage implements OnInit {
  private readonly api = inject(ExcepcionesApi);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  readonly estadoMeta = ESTADO_META;
  readonly claseMeta = CLASE_META;
  readonly origenMeta = ORIGEN_META;
  readonly eventoMeta = EVENTO_META;
  readonly estados = ESTADOS_EXCEPCION;
  readonly clases = CLASES_FALLO;
  readonly origenes = ORIGENES_EXCEPCION;

  readonly items = signal<Excepcion[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  // Filtros: estado y tarea van al backend; clase y origen se aplican en cliente.
  readonly estadoFiltro = signal<string>('');
  readonly tareaFiltro = signal<string>('');
  readonly claseFiltro = signal<ClaseFallo | ''>('');
  readonly origenFiltro = signal<OrigenExcepcion | ''>('');

  readonly selected = signal<ExcepcionDetalle | null>(null);
  readonly acting = signal(false);
  readonly panel = signal<PanelAccion | null>(null);

  // Formularios de acción.
  readonly nota = signal('');
  readonly siguienteAccionInput = signal('');
  readonly nuevoDueno = signal('');
  readonly motivoReasignar = signal('');
  readonly motivoCancelar = signal('');
  readonly resultadoConciliar = signal<ResultadoConciliacion>('CONFIRMADO');
  readonly detalleConciliar = signal('');

  readonly canEdit = computed(() => this.auth.canEdit());

  /** Vista: filtrado en cliente (clase/origen) y ordenado por atención, severidad y antigüedad. */
  readonly vista = computed(() =>
    ordenarBandeja(filtrarBandeja(this.items(), { clase: this.claseFiltro(), origen: this.origenFiltro() })),
  );
  readonly abiertas = computed(
    () => this.vista().filter((e) => e.estado === 'ABIERTA' || e.estado === 'EN_PROGRESO').length,
  );

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.items.set(
        await this.api.list({
          estado: (this.estadoFiltro() || undefined) as Excepcion['estado'] | undefined,
          tareaId: this.tareaFiltro().trim() || undefined,
        }),
      );
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async open(e: Excepcion) {
    this.panel.set(null);
    this.resetForms();
    // Muestra algo inmediato y luego refresca el detalle con su historial.
    this.selected.set({ ...e, eventos: [] });
    try {
      this.selected.set(await this.api.get(e.id));
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  close() {
    this.selected.set(null);
    this.panel.set(null);
  }

  togglePanel(p: PanelAccion) {
    this.panel.set(this.panel() === p ? null : p);
  }

  private resetForms() {
    this.nota.set('');
    this.siguienteAccionInput.set('');
    this.nuevoDueno.set('');
    this.motivoReasignar.set('');
    this.motivoCancelar.set('');
    this.resultadoConciliar.set('CONFIRMADO');
    this.detalleConciliar.set('');
  }

  // ---------- Presentación ----------

  conc = (e: Excepcion) => conciliacion(e);

  gate = (e: Excepcion, accion: AccionExcepcion) => puedeAccion(e.estado, accion, this.canEdit());
  gateMsg = (e: Excepcion, accion: AccionExcepcion): string | null => {
    const g = this.gate(e, accion);
    return g.ok ? null : g.mensaje;
  };

  hasKeys(value: unknown): boolean {
    return !!value && typeof value === 'object' && Object.keys(value as object).length > 0;
  }

  pretty(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  /** Refresca la excepción seleccionada tras una mutación, recargando también la lista. */
  private async aplicar(actualizada: Excepcion, mensaje: string) {
    this.toast.success(mensaje);
    this.panel.set(null);
    this.resetForms();
    try {
      this.selected.set(await this.api.get(actualizada.id));
    } catch {
      this.selected.set({ ...actualizada, eventos: this.selected()?.eventos ?? [] });
    }
    await this.load();
  }

  private guard(e: Excepcion, accion: AccionExcepcion): boolean {
    const g = this.gate(e, accion);
    if (!g.ok) this.toast.error(g.mensaje);
    return g.ok;
  }

  // ---------- Acciones ----------

  async aportarInfo(e: Excepcion) {
    if (!this.guard(e, 'info')) return;
    const nota = this.nota().trim();
    if (nota.length < 2) {
      this.toast.error('Escriba una nota de al menos 2 caracteres.');
      return;
    }
    this.acting.set(true);
    try {
      const upd = await this.api.aportarInfo(e.id, {
        nota,
        siguienteAccion: this.siguienteAccionInput().trim() || undefined,
      });
      await this.aplicar(upd, 'Información aportada al historial');
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.acting.set(false);
    }
  }

  async reintentar(e: Excepcion) {
    if (!this.guard(e, 'reintentar')) return;
    this.acting.set(true);
    try {
      const upd = await this.api.reintentar(e.id);
      await this.aplicar(upd, 'Reintento solicitado (protegido por idempotencia)');
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.acting.set(false);
    }
  }

  async reasignar(e: Excepcion) {
    if (!this.guard(e, 'reasignar')) return;
    const duenoUserId = this.nuevoDueno().trim();
    if (!duenoUserId) {
      this.toast.error('Indique el nuevo dueño (identificador de usuario).');
      return;
    }
    this.acting.set(true);
    try {
      const upd = await this.api.reasignar(e.id, { duenoUserId, motivo: this.motivoReasignar().trim() || undefined });
      await this.aplicar(upd, 'Excepción reasignada');
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.acting.set(false);
    }
  }

  async cancelar(e: Excepcion) {
    if (!this.guard(e, 'cancelar')) return;
    const motivo = this.motivoCancelar().trim();
    if (motivo.length < 3) {
      this.toast.error('Indique el motivo de la cancelación (mínimo 3 caracteres).');
      return;
    }
    this.acting.set(true);
    try {
      const upd = await this.api.cancelar(e.id, { motivo });
      await this.aplicar(upd, 'Excepción cancelada');
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.acting.set(false);
    }
  }

  async conciliar(e: Excepcion) {
    if (!this.guard(e, 'conciliar')) return;
    this.acting.set(true);
    try {
      const upd = await this.api.conciliar(e.id, {
        resultado: this.resultadoConciliar(),
        detalle: this.detalleConciliar().trim() || undefined,
      });
      await this.aplicar(
        upd,
        this.resultadoConciliar() === 'CONFIRMADO'
          ? 'Efecto confirmado en el destino: conciliada'
          : 'Registrado que el efecto no ocurrió: habilitar reintento seguro',
      );
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.acting.set(false);
    }
  }
}
