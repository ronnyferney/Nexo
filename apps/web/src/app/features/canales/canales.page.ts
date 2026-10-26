import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ChannelsApi } from '../../core/channels.api';
import type {
  CanalCuenta,
  CanalCuentaEstado,
  CanalTipo,
  CreateCanalCuentaInput,
  MensajeCanal,
  ResultadoPruebaCanal,
} from '../../core/channels.models';
import type { OrgUnitOption } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { JsonEditorComponent } from '../../shared/json-editor.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import {
  destinoPlaceholder,
  esProveedorSimulado,
  estadoCuentaMeta,
  estadoMensajeMeta,
  mensajeSecretRef,
  nuevaIdempotencyKey,
  tipoCanalMeta,
} from './canales.util';

const TIPOS: CanalTipo[] = ['CORREO', 'WHATSAPP', 'VOZ'];
const ESTADOS: CanalCuentaEstado[] = ['ACTIVA', 'SUSPENDIDA', 'RETIRADA'];

interface FormCuenta {
  id: string | null;
  empresaId: string;
  tipo: CanalTipo;
  proveedor: string;
  estado: CanalCuentaEstado;
  secretRef: string;
  config: Record<string, unknown>;
}

/**
 * Administración de cuentas de canal externo (E14 · ADR 0015) y envío en sandbox. Cuentas por empresa (correo,
 * WhatsApp, voz); crear/editar/probar exige ADMIN; el envío exige EDITOR. Las credenciales se referencian solo por
 * `secretRef` (nombre de la clave de bóveda), NUNCA el secreto en claro.
 */
@Component({
  selector: 'nx-canales-externos',
  imports: [FormsModule, DatePipe, IconComponent, JsonEditorComponent, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Canales externos</h1>
          <p>Cuentas de correo, WhatsApp y voz por empresa, con envío de prueba en sandbox.</p>
        </div>
        <div class="row wrap">
          <button class="btn" [disabled]="loading()" (click)="load()" title="Actualizar" aria-label="Actualizar">
            <nx-icon name="refresh" />
          </button>
          @if (isAdmin()) {
            <button class="btn primary" (click)="nuevo()"><nx-icon name="plus" />Nueva cuenta</button>
          }
        </div>
      </div>

      <div class="callout info" role="note">
        <nx-icon name="info" [size]="16" />
        <span>
          <strong>Modo sandbox.</strong> Con el proveedor <code>simulado</code> los envíos no salen a la red: quedan
          en estado <strong>SIMULADO</strong>. La activación productiva (m365, gmail, smtp, twilio, meta…) requiere
          credenciales por empresa en la bóveda y pasa por el gobierno de aprobaciones.
        </span>
      </div>

      @if (editor(); as f) {
        <form class="card stack editor" (ngSubmit)="guardar()" aria-labelledby="form-title">
          <h2 id="form-title">{{ f.id ? 'Editar cuenta de canal' : 'Nueva cuenta de canal' }}</h2>
          <div class="grid2">
            <div class="field">
              <label for="f-empresa">Empresa</label>
              <select id="f-empresa" name="empresa" class="input" required [(ngModel)]="f.empresaId">
                <option value="" disabled>Seleccione una empresa</option>
                @for (u of orgUnits(); track u.id) {
                  <option [value]="u.id">{{ u.name }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="f-tipo">Tipo de canal</label>
              <select id="f-tipo" name="tipo" class="input" [(ngModel)]="f.tipo">
                @for (t of tipos; track t) {
                  <option [value]="t">{{ tipoMeta(t).label }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="f-proveedor">Proveedor</label>
              <input id="f-proveedor" name="proveedor" class="input" required placeholder="simulado"
                [(ngModel)]="f.proveedor" />
              <span class="hint">En minúsculas (ej. simulado, m365, gmail, smtp, twilio, meta).</span>
            </div>
            <div class="field">
              <label for="f-estado">Estado</label>
              <select id="f-estado" name="estado" class="input" [(ngModel)]="f.estado">
                @for (e of estados; track e) {
                  <option [value]="e">{{ estadoCuentaMeta(e).label }}</option>
                }
              </select>
            </div>
          </div>
          <div class="field">
            <label for="f-secret">Clave de bóveda (secretRef)</label>
            <input id="f-secret" name="secretRef" class="input mono" placeholder="M365_CLIENT_SECRET"
              [class.invalid]="secretError()" [(ngModel)]="f.secretRef" (ngModelChange)="onSecretChange()"
              [attr.aria-invalid]="secretError() ? 'true' : null" aria-describedby="secret-help" />
            <span id="secret-help" class="hint" [class.danger-text]="secretError()">
              {{ secretError() || 'Solo el NOMBRE del secreto en la bóveda, nunca el valor. Opcional (vacío = cuenta sin credenciales).' }}
            </span>
          </div>
          <div class="field">
            <label>Configuración (sin secretos)</label>
            <nx-json-editor [(value)]="f.config" [rows]="5"
              placeholder='{ "remitente": "no-reply@empresa.com", "nombre": "Soporte" }' />
            <span class="hint">Identidad del canal (remitente, nombre visible…). No incluya credenciales aquí.</span>
          </div>
          <div class="row">
            <span class="spacer"></span>
            <button type="button" class="btn" (click)="editor.set(null)">Cancelar</button>
            <button type="submit" class="btn primary" [disabled]="busy() === 'save' || !formValido(f)">
              {{ busy() === 'save' ? 'Guardando…' : 'Guardar' }}
            </button>
          </div>
        </form>
      }

      @if (loading() && !cuentas().length) {
        <p class="muted" role="status">Cargando canales…</p>
      } @else if (error()) {
        <div class="card empty" role="alert">
          <nx-icon name="alert" [size]="32" /><h3>No se pudieron cargar los canales</h3>
          <p>{{ error() }}</p>
          <button class="btn" (click)="load()"><nx-icon name="refresh" />Reintentar</button>
        </div>
      } @else if (!cuentas().length) {
        <div class="card empty">
          <nx-icon name="send" [size]="36" /><h3>Sin cuentas de canal</h3>
          <p>Cree una cuenta con el proveedor <code>simulado</code> para enviar mensajes de prueba sin salir a la red.</p>
          @if (isAdmin()) {
            <div class="empty-actions"><button class="btn primary" (click)="nuevo()"><nx-icon name="plus" />Nueva cuenta</button></div>
          }
        </div>
      } @else {
        <div class="card flush">
          <div class="table-wrap">
            <table class="table">
              <caption class="sr-only">Cuentas de canal del workspace</caption>
              <thead>
                <tr>
                  <th scope="col">Empresa</th><th scope="col">Tipo</th><th scope="col">Proveedor</th>
                  <th scope="col">Estado</th><th scope="col">Credencial</th><th scope="col"><span class="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                @for (c of cuentas(); track c.id) {
                  <tr [class.sel]="c.id === selectedId()">
                    <td><strong>{{ empresaNombre(c.empresaId) }}</strong></td>
                    <td><span class="badge {{ tipoMeta(c.tipo).badge }}"><nx-icon [name]="tipoMeta(c.tipo).icon" [size]="13" />{{ tipoMeta(c.tipo).label }}</span></td>
                    <td class="mono small">{{ c.proveedor }}@if (esSandbox(c)) { <span class="badge info sm">sandbox</span> }</td>
                    <td><span class="badge {{ estadoCuentaMeta(c.estado).badge }}">{{ estadoCuentaMeta(c.estado).label }}</span></td>
                    <td class="mono small">{{ c.secretRef || '—' }}</td>
                    <td class="nowrap actions">
                      <button class="btn sm" (click)="seleccionar(c)" [attr.aria-label]="'Abrir ' + empresaNombre(c.empresaId)">
                        <nx-icon name="send" [size]="14" />Enviar
                      </button>
                      @if (isAdmin()) {
                        <button class="btn sm" [disabled]="busy() === 'test:' + c.id" (click)="probar(c)" [attr.aria-label]="'Probar ' + c.proveedor">
                          <nx-icon name="zap" [size]="14" />{{ busy() === 'test:' + c.id ? '…' : 'Probar' }}
                        </button>
                        <button class="btn sm icon" (click)="editar(c)" [attr.aria-label]="'Editar cuenta'"><nx-icon name="pencil" [size]="14" /></button>
                        <button class="btn sm icon danger" (click)="retirar(c)" [attr.aria-label]="'Retirar cuenta'"><nx-icon name="trash" [size]="14" /></button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>

        @if (testResult(); as r) {
          <div class="callout {{ r.ok ? 'info' : 'danger' }}" role="status">
            <nx-icon [name]="r.ok ? 'check' : 'alert'" [size]="16" />
            <span><strong>Prueba del adaptador:</strong> {{ r.message }}</span>
          </div>
        }

        @if (selected(); as c) {
          <section class="card stack" aria-labelledby="panel-title">
            <div class="row wrap">
              <h2 id="panel-title" class="grow">Enviar por «{{ empresaNombre(c.empresaId) }}» · {{ tipoMeta(c.tipo).label }}</h2>
              <button class="btn ghost icon" (click)="cerrarPanel()" aria-label="Cerrar panel" title="Cerrar"><nx-icon name="x" /></button>
            </div>

            @if (canEdit()) {
              <form class="stack" (ngSubmit)="enviar(c)">
                <div class="field">
                  <label for="s-destino">Destino</label>
                  <input id="s-destino" name="destino" class="input" required [placeholder]="destinoPlaceholder(c.tipo)" [(ngModel)]="sDestino" />
                </div>
                @if (c.tipo === 'CORREO') {
                  <div class="field">
                    <label for="s-asunto">Asunto</label>
                    <input id="s-asunto" name="asunto" class="input" [(ngModel)]="sAsunto" />
                  </div>
                }
                <div class="field">
                  <label for="s-cuerpo">Mensaje</label>
                  <textarea id="s-cuerpo" name="cuerpo" class="input" rows="3" required [(ngModel)]="sCuerpo"></textarea>
                </div>
                <div class="grid2">
                  <div class="field">
                    <label for="s-tarea">Tarea (opcional)</label>
                    <input id="s-tarea" name="tarea" class="input mono" placeholder="id de tarea E5" [(ngModel)]="sTareaId" />
                  </div>
                  <div class="field">
                    <label for="s-idem">Clave de idempotencia</label>
                    <div class="row">
                      <input id="s-idem" name="idem" class="input mono grow" required [(ngModel)]="sIdem" />
                      <button type="button" class="btn icon" (click)="regenerarIdem()" title="Generar otra clave" aria-label="Generar otra clave"><nx-icon name="refresh" [size]="14" /></button>
                    </div>
                    <span class="hint">Un reenvío con la misma clave no duplica el mensaje.</span>
                  </div>
                </div>
                <div class="row">
                  <span class="spacer"></span>
                  <button type="submit" class="btn primary" [disabled]="busy() === 'send' || !sDestino.trim() || !sCuerpo.trim() || !sIdem.trim()">
                    {{ busy() === 'send' ? 'Enviando…' : (esSandbox(c) ? 'Enviar en sandbox' : 'Enviar') }}
                  </button>
                </div>
              </form>
            } @else {
              <div class="callout" role="note"><nx-icon name="lock" [size]="16" /><span>Se necesita rol EDITOR o superior para enviar mensajes.</span></div>
            }

            <h3>Historial de mensajes</h3>
            @if (mensajesLoading()) {
              <p class="muted" role="status">Cargando mensajes…</p>
            } @else if (!mensajes().length) {
              <p class="muted">Aún no hay mensajes en esta cuenta.</p>
            } @else {
              <div class="table-wrap">
                <table class="table">
                  <caption class="sr-only">Mensajes de la cuenta</caption>
                  <thead><tr><th scope="col">Estado</th><th scope="col">Destino</th><th scope="col">Asunto</th><th scope="col">Enviado</th></tr></thead>
                  <tbody>
                    @for (m of mensajes(); track m.id) {
                      <tr>
                        <td><span class="badge {{ estadoMensajeMeta(m.estado).badge }}">{{ estadoMensajeMeta(m.estado).label }}</span>
                          @if (m.error) { <span class="muted small block">{{ m.error }}</span> }</td>
                        <td class="small">{{ m.destino }}</td>
                        <td class="small">{{ m.asunto || '—' }}</td>
                        <td class="muted small nowrap" [title]="m.createdAt | date: 'medium'">{{ m.createdAt | ago }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>
        }
      }
    </div>
  `,
  styles: `
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .flush { padding: 0; }
    .grow { flex: 1; min-width: 0; }
    .actions { text-align: right; }
    .actions .btn + .btn { margin-left: 6px; }
    .badge.sm { height: 18px; font-size: 10px; margin-left: 6px; }
    .danger-text { color: var(--danger); }
    tr.sel { background: var(--primary-50); }
    @media (max-width: 640px) { .grid2 { grid-template-columns: 1fr; } }
  `,
})
export class CanalesPage implements OnInit {
  private readonly channels = inject(ChannelsApi);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly cuentas = signal<CanalCuenta[]>([]);
  readonly orgUnits = signal<OrgUnitOption[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal<string | null>(null);

  readonly editor = signal<FormCuenta | null>(null);
  readonly secretError = signal<string | null>(null);

  readonly selectedId = signal<string | null>(null);
  readonly mensajes = signal<MensajeCanal[]>([]);
  readonly mensajesLoading = signal(false);
  readonly testResult = signal<ResultadoPruebaCanal | null>(null);

  readonly isAdmin = this.auth.isAdmin;
  readonly canEdit = this.auth.canEdit;

  readonly tipos = TIPOS;
  readonly estados = ESTADOS;
  readonly tipoMeta = tipoCanalMeta;
  readonly estadoCuentaMeta = estadoCuentaMeta;
  readonly estadoMensajeMeta = estadoMensajeMeta;
  readonly destinoPlaceholder = destinoPlaceholder;

  private readonly empresaMap = computed(() => new Map(this.orgUnits().map((u) => [u.id, u.name])));
  readonly selected = computed(() => this.cuentas().find((c) => c.id === this.selectedId()) ?? null);

  // Formulario de envío (sandbox)
  sDestino = '';
  sAsunto = '';
  sCuerpo = '';
  sTareaId = '';
  sIdem = '';

  async ngOnInit() {
    void this.loadOrgUnits();
    await this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.cuentas.set(await this.channels.cuentas());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadOrgUnits() {
    try {
      this.orgUnits.set(await this.api.orgUnits());
    } catch {
      // Los nombres de empresa son un lujo: si fallan, mostramos el id abreviado.
    }
  }

  empresaNombre(id: string): string {
    return this.empresaMap().get(id) ?? `…${id.slice(-6)}`;
  }

  esSandbox(c: CanalCuenta): boolean {
    return esProveedorSimulado(c.proveedor);
  }

  // ---------- Cuentas ----------
  nuevo() {
    this.editor.set({ id: null, empresaId: '', tipo: 'CORREO', proveedor: 'simulado', estado: 'ACTIVA', secretRef: '', config: {} });
    this.secretError.set(null);
  }

  editar(c: CanalCuenta) {
    this.editor.set({ id: c.id, empresaId: c.empresaId, tipo: c.tipo, proveedor: c.proveedor, estado: c.estado, secretRef: c.secretRef ?? '', config: { ...c.config } });
    this.secretError.set(null);
  }

  onSecretChange() {
    this.secretError.set(mensajeSecretRef(this.editor()?.secretRef ?? ''));
  }

  formValido(f: FormCuenta): boolean {
    return !!f.empresaId && !!f.proveedor.trim() && !this.secretError();
  }

  async guardar() {
    const f = this.editor();
    if (!f || !this.formValido(f)) return;
    const secretRef = f.secretRef.trim();
    const payload: CreateCanalCuentaInput = {
      empresaId: f.empresaId,
      tipo: f.tipo,
      proveedor: f.proveedor.trim().toLowerCase(),
      estado: f.estado,
      secretRef: secretRef || undefined,
      config: f.config ?? {},
    };
    this.busy.set('save');
    try {
      if (f.id) await this.channels.updateCuenta(f.id, payload);
      else await this.channels.createCuenta(payload);
      this.toast.success(f.id ? 'Cuenta actualizada' : 'Cuenta creada');
      this.editor.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  async retirar(c: CanalCuenta) {
    if (!confirm(`¿Retirar la cuenta de ${this.empresaNombre(c.empresaId)} (${c.proveedor})? Dejará de poder enviar.`)) return;
    this.busy.set('del:' + c.id);
    try {
      await this.channels.removeCuenta(c.id);
      this.toast.success('Cuenta retirada');
      if (this.selectedId() === c.id) this.cerrarPanel();
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  async probar(c: CanalCuenta) {
    this.busy.set('test:' + c.id);
    this.testResult.set(null);
    try {
      const r = await this.channels.testCuenta(c.id);
      this.testResult.set(r);
      if (r.ok) this.toast.success('Prueba correcta');
      else this.toast.error('La prueba falló');
    } catch (e) {
      this.testResult.set({ ok: false, message: errorMessage(e) });
    } finally {
      this.busy.set(null);
    }
  }

  // ---------- Panel de envío ----------
  seleccionar(c: CanalCuenta) {
    this.selectedId.set(c.id);
    this.testResult.set(null);
    this.sDestino = '';
    this.sAsunto = '';
    this.sCuerpo = '';
    this.sTareaId = '';
    this.sIdem = nuevaIdempotencyKey();
    void this.loadMensajes(c.id);
  }

  cerrarPanel() {
    this.selectedId.set(null);
    this.mensajes.set([]);
  }

  regenerarIdem() {
    this.sIdem = nuevaIdempotencyKey();
  }

  private async loadMensajes(cuentaId: string) {
    this.mensajesLoading.set(true);
    try {
      this.mensajes.set(await this.channels.mensajes(cuentaId));
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.mensajesLoading.set(false);
    }
  }

  async enviar(c: CanalCuenta) {
    if (!this.sDestino.trim() || !this.sCuerpo.trim() || !this.sIdem.trim()) return;
    this.busy.set('send');
    try {
      const msg = await this.channels.enviar(c.id, {
        destino: this.sDestino.trim(),
        asunto: c.tipo === 'CORREO' && this.sAsunto.trim() ? this.sAsunto.trim() : undefined,
        cuerpo: this.sCuerpo,
        idempotencyKey: this.sIdem.trim(),
        tareaId: this.sTareaId.trim() || undefined,
      });
      const meta = estadoMensajeMeta(msg.estado);
      if (msg.estado === 'FALLIDO') this.toast.error(`Envío ${meta.label}: ${msg.error ?? 'sin detalle'}`);
      else this.toast.success(`Mensaje en estado ${meta.label}`);
      this.sIdem = nuevaIdempotencyKey();
      await this.loadMensajes(c.id);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }
}
