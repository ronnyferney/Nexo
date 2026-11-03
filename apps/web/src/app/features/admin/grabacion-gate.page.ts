import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { GrabacionConfig, OrgUnit } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

/**
 * Gate jurídico de grabación por empresa (E14 · ADR 0015 · decisión Jurídica D7). Hasta activar
 * `grabacionAutorizadaJuridicamente`, NADA se graba aunque las banderas de tipo estén en ON: la grabación real queda
 * OFF hasta la validación jurídica. Solo ADMIN/OWNER lo cambia; el cambio queda auditado en el backend.
 */
@Component({
  selector: 'nx-grabacion-gate',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div><h1>Gate de grabación de voz</h1><p>Autorización jurídica por empresa antes de grabar llamadas</p></div>
        <button class="btn" (click)="loadEmpresas()" [disabled]="loadingEmpresas()"><nx-icon name="refresh" [size]="15" />Actualizar</button>
      </div>

      <div class="callout warning" style="margin-bottom:16px" role="note"><nx-icon name="alert" [size]="16" /><span>
        La grabación real está <strong>OFF hasta la validación jurídica</strong>. Aunque se habiliten banderas de tipo
        (audio, transcripción…), nada se graba mientras este gate esté desactivado. Es un control técnico: no declara
        cumplimiento normativo ni valor probatorio.</span></div>

      @if (loadingEmpresas()) {
        <div class="card empty"><p>Cargando empresas…</p></div>
      } @else if (empresasError()) {
        <div class="card empty" role="alert"><nx-icon name="alert" [size]="28" /><h3>No se pudieron cargar las empresas</h3>
          <p>{{ empresasError() }}</p><button class="btn" (click)="loadEmpresas()">Reintentar</button></div>
      } @else if (!empresas().length) {
        <div class="card empty"><nx-icon name="building" [size]="28" /><h3>No hay empresas</h3>
          <p>Cree empresas en la estructura de la organización para configurar su grabación.</p></div>
      } @else {
        <div class="card stack">
          <div class="field" style="max-width:360px"><label for="g-empresa">Empresa</label>
            <select id="g-empresa" class="input" [ngModel]="empresaId()" (ngModelChange)="selectEmpresa($event)">
              <option value="">— Seleccione una empresa —</option>
              @for (e of empresas(); track e.id) { <option [value]="e.id">{{ e.name }}</option> }
            </select></div>

          @if (empresaId()) {
            @if (loading()) {
              <p class="muted small">Cargando configuración…</p>
            } @else if (error()) {
              <div class="callout warning" role="alert"><nx-icon name="alert" [size]="16" /><span>{{ error() }}</span>
                <button class="btn sm" (click)="loadConfig()">Reintentar</button></div>
            } @else if (config(); as c) {
              <div class="row" style="gap:12px; align-items:center">
                <span class="badge" [class.info]="c.grabacionAutorizadaJuridicamente" [class.danger]="!c.grabacionAutorizadaJuridicamente">
                  {{ c.grabacionAutorizadaJuridicamente ? 'Autorizada' : 'No autorizada' }}</span>
                @if (!c.configurado) { <span class="muted small">Sin configuración previa (todo OFF por defecto)</span> }
                <span class="spacer"></span>
                @if (canEdit()) {
                  <button class="btn" [class.primary]="!c.grabacionAutorizadaJuridicamente" [class.danger]="c.grabacionAutorizadaJuridicamente"
                    [disabled]="saving()" (click)="toggle()">
                    <nx-icon [name]="c.grabacionAutorizadaJuridicamente ? 'stop' : 'check'" [size]="15" />
                    {{ saving() ? 'Guardando…' : (c.grabacionAutorizadaJuridicamente ? 'Revocar autorización' : 'Autorizar jurídicamente') }}
                  </button>
                }
              </div>
              @if (!canEdit()) { <p class="muted small">Solo un administrador puede cambiar la autorización jurídica.</p> }
            }
          }
        </div>
      }
    </div>
  `,
})
export class GrabacionGatePage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly canEdit = this.auth.isAdmin;

  readonly empresas = signal<OrgUnit[]>([]);
  readonly loadingEmpresas = signal(true);
  readonly empresasError = signal<string | null>(null);

  readonly empresaId = signal<string>('');
  readonly config = signal<GrabacionConfig | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);

  ngOnInit() {
    void this.loadEmpresas();
  }

  async loadEmpresas() {
    this.loadingEmpresas.set(true);
    this.empresasError.set(null);
    try {
      const units = await this.api.adminOrgUnits();
      this.empresas.set(units.filter((u) => u.tipo === 'EMPRESA'));
    } catch (e) {
      this.empresasError.set(errorMessage(e));
    } finally {
      this.loadingEmpresas.set(false);
    }
  }

  selectEmpresa(id: string) {
    this.empresaId.set(id);
    this.config.set(null);
    this.error.set(null);
    if (id) void this.loadConfig();
  }

  async loadConfig() {
    const id = this.empresaId();
    if (!id) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      this.config.set(await this.api.grabacionConfig(id));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async toggle() {
    const c = this.config();
    const id = this.empresaId();
    if (!c || !id) return;
    const next = !c.grabacionAutorizadaJuridicamente;
    if (
      !confirm(
        next
          ? '¿Autorizar jurídicamente la grabación de esta empresa? Habilita que, con las banderas de tipo en ON, se grabe.'
          : '¿Revocar la autorización jurídica? La grabación real quedará OFF de inmediato.',
      )
    )
      return;
    this.saving.set(true);
    try {
      this.config.set(await this.api.setGrabacionConfig(id, { grabacionAutorizadaJuridicamente: next }));
      this.toast.success(next ? 'Grabación autorizada jurídicamente' : 'Autorización jurídica revocada');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
