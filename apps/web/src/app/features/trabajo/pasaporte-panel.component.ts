import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { errorMessage } from '../../core/api.service';
import { PasaporteApi } from '../../core/pasaporte.api';
import type { EstadoResultado } from '../../core/results.models';
import type { PasaporteResultado } from '../../core/pasaporte.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import {
  accionPasaporte,
  autorPasaporte,
  claveAlmacen,
  conteosVista,
  formatCostoTotal,
  veredictoVista,
} from './pasaporte.util';

/**
 * Panel del Pasaporte de Resultado (ADR 0014 · E14): la hoja de vida verificable de un `ContratoResultado` ACEPTADO.
 * Muestra la CADENA DE CUSTODIA (referencias + hashes anclados a la auditoría inmutable), permite EMITIRLA (EDITOR+),
 * VERIFICARLA extremo a extremo y EXPORTARLA para un auditor externo. Nunca expone datos sensibles: solo referencias,
 * hashes y totales. Las listas vacías (p. ej. conectores) se muestran con honestidad; no se inventan datos.
 *
 * El backend no ofrece (aún) un endpoint para listar el pasaporte de un contrato: solo `POST .../passport` (emisión) y
 * `GET /passports/:id`. Para que la hoja siga visible tras recargar, se guarda localmente el id del último pasaporte
 * conocido (puntero de conveniencia, no fuente de verdad): al abrir se recupera con `GET /passports/:id`, y si ya no
 * existe se limpia y se vuelve a ofrecer la emisión.
 */
@Component({
  selector: 'nx-pasaporte-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, IconComponent, EmptyStateComponent, RelativeTimePipe],
  template: `
    <div class="bloque pasaporte">
      <h3><nx-icon name="shield" [size]="14" />Pasaporte de resultado</h3>

      @if (loading()) {
        <p class="muted cargando" role="status"><nx-icon name="clock" [size]="14" />Cargando el pasaporte…</p>
      } @else if (error()) {
        <p class="estado-nota err" role="alert"><nx-icon name="alert" [size]="15" />{{ error() }}</p>
      } @else if (accion() === 'emitir') {
        <nx-empty-state
          icon="shield"
          title="Sin pasaporte emitido"
          description="Emite la cadena de custodia verificable del resultado aceptado: quién lo hizo, con qué y a qué costo, anclada a la auditoría inmutable y a prueba de manipulación.">
          @if (canEdit()) {
            <div class="empty-actions">
              <button class="btn primary" [disabled]="busy()" (click)="emitir()">
                <nx-icon name="rocket" [size]="16" />Emitir pasaporte
              </button>
            </div>
          } @else {
            <p class="muted">Solo un editor puede emitir el pasaporte.</p>
          }
        </nx-empty-state>
      } @else if (pasaporte(); as p) {
        <p class="valor" role="note">
          <nx-icon name="lock" [size]="14" />Cadena de custodia verificable, a prueba de manipulación.
        </p>

        <!-- Quién -->
        <div class="sub">
          <span class="sub-t">Quién</span>
          <span class="autor badge" [class.success]="autor(p).tipo === 'humano'" [class.info]="autor(p).tipo === 'digital'">
            <nx-icon [name]="autor(p).icon" [size]="13" />Emitido por {{ autor(p).etiqueta }}
          </span>
          <span class="muted fecha">{{ p.createdAt | ago }} · {{ p.createdAt | date: 'medium' }}</span>
        </div>
        @if (p.documentoRef.agentes.length) {
          <ul class="agentes">
            @for (a of p.documentoRef.agentes; track a.agentId) {
              <li>
                <nx-icon name="bot" [size]="13" />
                <code>…{{ a.agentId.slice(-6) }}</code>
                @for (r of a.roles; track r) {
                  <span class="badge sm">{{ r }}</span>
                }
                @if (a.responsableUserId) {
                  <span class="muted">· responsable humano</span>
                }
              </li>
            }
          </ul>
        } @else {
          <p class="muted">Sin agentes referenciados.</p>
        }

        <!-- Con qué / cuánto -->
        <div class="sub"><span class="sub-t">Con qué y a qué costo</span></div>
        <dl class="conteos">
          <div class="costo">
            <dt><nx-icon name="wallet" [size]="14" />Costo total imputado</dt>
            <dd>{{ costoTotal(p) }}</dd>
          </div>
          @for (c of conteos(p); track c.label) {
            <div [class.cero]="c.valor === 0">
              <dt><nx-icon [name]="c.icon" [size]="13" />{{ c.label }}</dt>
              <dd>{{ c.valor }}</dd>
            </div>
          }
        </dl>
        @if (!p.documentoRef.conectores.length) {
          <p class="muted">Sin conectores enlazados a este resultado.</p>
        }

        <!-- Huella + ancla -->
        <div class="sub"><span class="sub-t">Huella y ancla inmutable</span></div>
        <dl class="campos">
          <dt><nx-icon name="hash" [size]="13" />Huella del documento</dt>
          <dd><code class="hash">{{ p.documentHash }}</code></dd>
          <dt><nx-icon name="link" [size]="13" />Ancla de auditoría</dt>
          <dd>secuencia #{{ p.auditSeq }} · <code>…{{ p.auditEntryId.slice(-8) }}</code></dd>
          @if (p.reemplazaAId) {
            <dt><nx-icon name="repeat" [size]="13" />Reemplaza a</dt>
            <dd><code>…{{ p.reemplazaAId.slice(-8) }}</code> (reemisión tras reapertura)</dd>
          }
        </dl>

        <!-- Veredicto de verificación -->
        @if (veredicto(); as v) {
          <p class="estado-nota" [class.ok]="v.ok" [class.err]="!v.ok" role="status">
            <nx-icon [name]="v.ok ? 'checkCircle' : 'xCircle'" [size]="15" />
            <span><strong>{{ v.titulo }}.</strong> {{ v.detalle }}</span>
          </p>
        }

        <!-- Acciones -->
        <div class="acciones">
          <button class="btn primary" [disabled]="busy()" (click)="verificar()" title="Verificar la integridad de extremo a extremo">
            <nx-icon name="shield" [size]="15" />Verificar
          </button>
          <button class="btn" [disabled]="busy()" (click)="exportar()" title="Descargar el pasaporte para un auditor externo">
            <nx-icon name="file" [size]="15" />Exportar
          </button>
          @if (canEdit()) {
            <button class="btn ghost" [disabled]="busy()" (click)="emitir()" title="Reemitir (crea un pasaporte nuevo si el resultado cambió)">
              <nx-icon name="rocket" [size]="15" />Reemitir
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .pasaporte { display: flex; flex-direction: column; gap: 10px; }
    h3 { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); margin: 0; text-transform: uppercase; letter-spacing: 0.04em; }
    .cargando { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 13px; }
    .valor { display: flex; align-items: center; gap: 6px; margin: 0; padding: 8px 10px; background: var(--primary-50); color: var(--primary); border-radius: 8px; font-size: 12.5px; font-weight: 600; }
    .sub { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 2px; }
    .sub-t { font-size: 11.5px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .autor { display: inline-flex; align-items: center; gap: 4px; }
    .fecha { font-size: 12px; }
    .agentes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
    .agentes li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; }
    .badge.sm { font-size: 10.5px; padding: 1px 6px; }
    .conteos { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; margin: 0; }
    .conteos > div { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; background: var(--surface-2); border-radius: 8px; }
    .conteos dt { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--muted); font-weight: 600; margin: 0; }
    .conteos dd { margin: 0; font-size: 16px; font-weight: 700; }
    .conteos .costo dd { font-size: 15px; color: var(--primary); }
    .conteos .cero { opacity: 0.6; }
    .campos { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 0; }
    .campos dt { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 12.5px; font-weight: 600; }
    .campos dd { margin: 0; font-size: 13px; }
    code { font-family: var(--font-mono, monospace); font-size: 12px; }
    code.hash { word-break: break-all; }
    .estado-nota { display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 10px 12px; border-radius: 9px; font-size: 13px; }
    .estado-nota.ok { background: var(--success-50); color: var(--success); }
    .estado-nota.err { background: var(--danger-50); color: var(--danger); }
    .acciones { display: flex; flex-wrap: wrap; gap: 8px; }
    @media (max-width: 560px) { .campos { grid-template-columns: 1fr; gap: 2px 0; } }
  `,
})
export class PasaportePanelComponent implements OnInit {
  private readonly api = inject(PasaporteApi);
  private readonly toast = inject(ToastService);

  readonly contratoId = input.required<string>();
  readonly estado = input.required<EstadoResultado>();
  readonly canEdit = input(false);

  protected readonly pasaporte = signal<PasaporteResultado | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly veredicto = computed(() => {
    const v = this.verificacion();
    return v ? veredictoVista(v.ok, v.motivo) : null;
  });
  private readonly verificacion = signal<{ ok: boolean; motivo?: string } | null>(null);

  protected readonly accion = computed(() => accionPasaporte(this.estado(), this.pasaporte()));

  protected autor = (p: PasaporteResultado) => autorPasaporte(p.emitidoPorUserId);
  protected costoTotal = (p: PasaporteResultado) => formatCostoTotal(p.documentoRef.totales.costoTotalUsd);
  protected conteos = (p: PasaporteResultado) => conteosVista(p.documentoRef);

  ngOnInit() {
    void this.cargarDesdeAlmacen();
  }

  /** Recupera el pasaporte conocido localmente (puntero de conveniencia) y confirma contra el backend. */
  private async cargarDesdeAlmacen() {
    const id = this.leerAlmacen();
    if (!id) return;
    this.loading.set(true);
    try {
      const p = await this.api.get(id);
      this.pasaporte.set(p);
    } catch {
      // El puntero apunta a algo que ya no existe o no es visible: se limpia y se vuelve a ofrecer emitir.
      this.borrarAlmacen();
    } finally {
      this.loading.set(false);
    }
  }

  protected async emitir() {
    this.busy.set(true);
    this.error.set(null);
    try {
      const p = await this.api.emitir(this.contratoId());
      this.pasaporte.set(p);
      this.verificacion.set(null);
      this.guardarAlmacen(p.id);
      this.toast.success('Pasaporte emitido');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async verificar() {
    const p = this.pasaporte();
    if (!p) return;
    this.busy.set(true);
    try {
      const r = await this.api.verify(p.id);
      this.verificacion.set({ ok: r.ok, motivo: r.motivo });
      if (r.ok) this.toast.success('Pasaporte íntegro y verificado');
      else this.toast.error('El pasaporte no verifica');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async exportar() {
    const p = this.pasaporte();
    if (!p) return;
    this.busy.set(true);
    try {
      const data = await this.api.export(p.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pasaporte-${p.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.toast.success('Pasaporte exportado');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  private leerAlmacen(): string | null {
    try {
      return localStorage.getItem(claveAlmacen(this.contratoId()));
    } catch {
      return null;
    }
  }
  private guardarAlmacen(id: string) {
    try {
      localStorage.setItem(claveAlmacen(this.contratoId()), id);
    } catch {
      // almacenamiento no disponible: la hoja seguirá visible solo durante la sesión actual
    }
  }
  private borrarAlmacen() {
    try {
      localStorage.removeItem(claveAlmacen(this.contratoId()));
    } catch {
      // nada que limpiar
    }
  }
}
