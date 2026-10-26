import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { OrgUnitOption } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { VoiceApi } from '../../core/voice.api';
import type { CanalCuentaEstado, DireccionMensaje } from '../../core/channels.models';
import type { GobiernoLlamada, VozCuenta, VozLlamada, VozModoDialogo } from '../../core/voice.models';
import { IconComponent } from '../../shared/icon.component';
import { JsonEditorComponent } from '../../shared/json-editor.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { estadoCuentaMeta, mensajeSecretRef, nuevaIdempotencyKey } from '../canales/canales.util';
import {
  capaLabel,
  estadoActivacion,
  estadoLlamadaMeta,
  llamadaActiva,
  proveedorInfo,
  validarRequisitosVoz,
  VOZ_CAPAS,
  VOZ_PROVEEDORES,
} from './voz.util';

/** Un turno mostrado en la conversación simulada (no se persiste; la transcripción es dato NO confiable). */
interface TurnoVista {
  rol: 'usuario' | 'agente';
  texto: string;
  gobierno?: GobiernoLlamada;
}

interface FormCuenta {
  empresaId: string;
  proveedor: string;
  estado: CanalCuentaEstado;
  secretRef: string;
  config: Record<string, unknown>;
}

/**
 * Voz (E14 · ADR 0015 D2), sandbox SIN gasto. Administra cuentas de voz por empresa (crear exige ADMIN; credenciales
 * solo por `secretRef`), muestra las capabilities por capa y el estado de activación del adaptador, y permite SIMULAR
 * una llamada (iniciar → turnos → transferir → finalizar) con rol EDITOR. No hay telefonía real: el `simulado` no sale a
 * la red y los proveedores productivos quedan inactivos hasta tener credenciales y presupuesto aprobado.
 */
@Component({
  selector: 'nx-voz',
  imports: [FormsModule, DatePipe, IconComponent, JsonEditorComponent, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Voz</h1>
          <p>Cuentas de voz por empresa y simulación del ciclo de una llamada, en modo sandbox.</p>
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

      <div class="callout warning" role="note">
        <nx-icon name="info" [size]="16" />
        <span>
          <strong>Modo sandbox — no hay telefonía real.</strong> Con el proveedor <code>simulado</code> la llamada no
          sale a la red: queda en estado <strong>SIMULADA</strong>. La activación productiva (Amazon Connect, Google
          Cloud…) requiere elegir el proveedor por prueba técnica, credenciales en la bóveda y
          <strong>presupuesto aprobado</strong>. Los webhooks de voz entrante existen en el backend pero NO se activan
          desde esta pantalla.
        </span>
      </div>

      @if (editor(); as f) {
        <form class="card stack editor" (ngSubmit)="guardar()" aria-labelledby="voz-form-title">
          <h2 id="voz-form-title">Nueva cuenta de voz</h2>
          <div class="grid2">
            <div class="field">
              <label for="vf-empresa">Empresa</label>
              <select id="vf-empresa" name="empresa" class="input" required [(ngModel)]="f.empresaId">
                <option value="" disabled>Seleccione una empresa</option>
                @for (u of orgUnits(); track u.id) {
                  <option [value]="u.id">{{ u.name }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="vf-proveedor">Proveedor</label>
              <select id="vf-proveedor" name="proveedor" class="input" [(ngModel)]="f.proveedor">
                @for (p of proveedores; track p.proveedor) {
                  <option [value]="p.proveedor">{{ p.legible }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="vf-estado">Estado</label>
              <select id="vf-estado" name="estado" class="input" [(ngModel)]="f.estado">
                @for (e of estadosCuenta; track e) {
                  <option [value]="e">{{ estadoCuentaMeta(e).label }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="vf-secret">Clave de bóveda (secretRef)</label>
              <input id="vf-secret" name="secretRef" class="input mono" placeholder="CONNECT_CREDS"
                [class.invalid]="secretError()" [(ngModel)]="f.secretRef" (ngModelChange)="onSecretChange()"
                [attr.aria-invalid]="secretError() ? 'true' : null" aria-describedby="vf-secret-help" />
              <span id="vf-secret-help" class="hint" [class.danger-text]="secretError()">
                {{ secretError() || 'Solo el NOMBRE del secreto en la bóveda, nunca el valor. Opcional (vacío = sin credenciales).' }}
              </span>
            </div>
          </div>

          @if (activacionEditor(); as a) {
            <div class="callout {{ a.badge === 'danger' ? 'danger' : a.activo ? 'info' : 'warning' }}" role="status">
              <nx-icon [name]="a.activo ? 'check' : 'lock'" [size]="16" />
              <span><strong>{{ a.label }}.</strong> {{ a.detalle }}</span>
            </div>
          }

          <div class="field">
            <label>Configuración (sin secretos)</label>
            <nx-json-editor [(value)]="f.config" [rows]="4"
              placeholder='{ "numero": "+57 1 000 0000", "region": "us-east-1" }' />
            <span class="hint">Identidad del canal (número, región, capabilities). No incluya credenciales aquí.</span>
          </div>
          <div class="row">
            <span class="spacer"></span>
            <button type="button" class="btn" (click)="editor.set(null)">Cancelar</button>
            <button type="submit" class="btn primary" [disabled]="busy() === 'save' || !formValido(f)">
              {{ busy() === 'save' ? 'Guardando…' : 'Crear cuenta' }}
            </button>
          </div>
        </form>
      }

      @if (loading() && !cuentas().length) {
        <p class="muted" role="status">Cargando cuentas de voz…</p>
      } @else if (error()) {
        <div class="card empty" role="alert">
          <nx-icon name="alert" [size]="32" /><h3>No se pudieron cargar las cuentas de voz</h3>
          <p>{{ error() }}</p>
          <button class="btn" (click)="load()"><nx-icon name="refresh" />Reintentar</button>
        </div>
      } @else if (!cuentas().length) {
        <div class="card empty">
          <nx-icon name="headset" [size]="36" /><h3>Sin cuentas de voz</h3>
          <p>Cree una cuenta con el proveedor <code>simulado</code> para ensayar el ciclo de una llamada sin salir a la red.</p>
          @if (isAdmin()) {
            <div class="empty-actions"><button class="btn primary" (click)="nuevo()"><nx-icon name="plus" />Nueva cuenta</button></div>
          }
        </div>
      } @else {
        <div class="card flush">
          <div class="table-wrap">
            <table class="table">
              <caption class="sr-only">Cuentas de voz del workspace</caption>
              <thead>
                <tr>
                  <th scope="col">Empresa</th><th scope="col">Proveedor</th><th scope="col">Estado</th>
                  <th scope="col">Activación</th><th scope="col">Credencial</th>
                  <th scope="col"><span class="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                @for (c of cuentas(); track c.id) {
                  <tr [class.sel]="c.id === selectedId()">
                    <td><strong>{{ empresaNombre(c.empresaId) }}</strong></td>
                    <td class="mono small">{{ proveedorLegible(c.proveedor) }}</td>
                    <td><span class="badge {{ estadoCuentaMeta(c.estado).badge }}">{{ estadoCuentaMeta(c.estado).label }}</span></td>
                    <td><span class="badge {{ activacion(c).badge }}" [title]="activacion(c).detalle">{{ activacion(c).label }}</span></td>
                    <td class="mono small">{{ c.secretRef || '—' }}</td>
                    <td class="nowrap actions">
                      <button class="btn sm" (click)="seleccionar(c)" [attr.aria-label]="'Abrir ' + empresaNombre(c.empresaId)">
                        <nx-icon name="headset" [size]="14" />Abrir
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>

        @if (selected(); as c) {
          <section class="card stack" aria-labelledby="voz-panel-title">
            <div class="row wrap">
              <h2 id="voz-panel-title" class="grow">«{{ empresaNombre(c.empresaId) }}» · {{ proveedorLegible(c.proveedor) }}</h2>
              <button class="btn ghost icon" (click)="cerrarPanel()" aria-label="Cerrar panel" title="Cerrar"><nx-icon name="x" /></button>
            </div>

            @if (activacion(c); as a) {
              <div class="callout {{ a.badge === 'danger' ? 'danger' : a.activo ? 'info' : 'warning' }}" role="note">
                <nx-icon [name]="a.activo ? 'check' : 'lock'" [size]="16" />
                <span><strong>{{ a.label }}.</strong> {{ a.detalle }}</span>
              </div>
            }

            @if (info(c.proveedor); as pi) {
              <h3>Capabilities por capa</h3>
              <div class="caps">
                @for (capa of capas; track capa) {
                  <div class="cap">
                    <div class="cap-head">{{ capaLabel(capa) }}</div>
                    <div class="chips">
                      @for (cap of capsDeCapa(pi, capa); track cap) {
                        <span class="badge sm">{{ cap }}</span>
                      } @empty {
                        <span class="muted small">—</span>
                      }
                    </div>
                    <p class="muted small req">{{ reqDeCapa(pi, capa)?.recursos }}</p>
                    <p class="muted small req"><strong>Falta cotizar:</strong> {{ reqDeCapa(pi, capa)?.faltaCotizar }}</p>
                  </div>
                }
              </div>
            }

            <h3>Simular una llamada</h3>
            @if (canEdit()) {
              @if (!activeCall()) {
                <form class="stack" (ngSubmit)="iniciarLlamada(c)">
                  <div class="grid2">
                    <div class="field">
                      <label for="l-direccion">Dirección</label>
                      <select id="l-direccion" name="direccion" class="input" [ngModel]="direccion()" (ngModelChange)="direccion.set($event)">
                        <option value="SALIENTE">Saliente</option>
                        <option value="ENTRANTE">Entrante</option>
                      </select>
                    </div>
                    <div class="field">
                      <label for="l-numero">Número</label>
                      <input id="l-numero" name="numero" class="input mono" required placeholder="+57 300 000 0000" [(ngModel)]="numero" />
                    </div>
                  </div>
                  <fieldset class="reqs">
                    <legend>Requisitos de la llamada</legend>
                    <label class="check"><input type="checkbox" name="transf" [ngModel]="reqTransferencia()" (ngModelChange)="reqTransferencia.set($event)" /> Transferencia a humano</label>
                    <label class="check"><input type="checkbox" name="barge" [ngModel]="reqBargeIn()" (ngModelChange)="reqBargeIn.set($event)" /> Barge-in (interrupción)</label>
                    <label class="check inline">
                      Diálogo
                      <select name="dialogo" class="input sm" [ngModel]="reqDialogo()" (ngModelChange)="reqDialogo.set($event)">
                        <option value="externalDialog">Controlado por NEXO</option>
                        <option value="providerDialog">Del proveedor</option>
                      </select>
                    </label>
                  </fieldset>

                  @if (requisitoProblemas(c.proveedor).length) {
                    <div class="callout danger" role="alert">
                      <nx-icon name="alert" [size]="16" />
                      <span>
                        <strong>Combinación incompatible con el proveedor:</strong>
                        <ul class="tight">
                          @for (p of requisitoProblemas(c.proveedor); track p) { <li>{{ p }}</li> }
                        </ul>
                      </span>
                    </div>
                  }

                  <div class="field">
                    <label for="l-idem">Clave de idempotencia</label>
                    <div class="row">
                      <input id="l-idem" name="idem" class="input mono grow" required [(ngModel)]="idem" />
                      <button type="button" class="btn icon" (click)="regenerarIdem()" title="Generar otra clave" aria-label="Generar otra clave"><nx-icon name="refresh" [size]="14" /></button>
                    </div>
                    <span class="hint">Un reinicio con la misma clave no origina dos llamadas.</span>
                  </div>
                  <div class="row">
                    <span class="spacer"></span>
                    <button type="submit" class="btn primary"
                      [disabled]="busy() === 'iniciar' || !numero.trim() || !idem.trim() || requisitoProblemas(c.proveedor).length">
                      {{ busy() === 'iniciar' ? 'Iniciando…' : 'Iniciar llamada simulada' }}
                    </button>
                  </div>
                </form>
              } @else {
                <div class="stack call-live">
                  <div class="row wrap call-status">
                    <span class="badge {{ estadoLlamadaMeta(activeCall()!.estado).badge }}">{{ estadoLlamadaMeta(activeCall()!.estado).label }}</span>
                    <span class="mono small muted">{{ activeCall()!.direccion === 'SALIENTE' ? 'Saliente' : 'Entrante' }} · {{ activeCall()!.proveedorCallId }}</span>
                    <span class="spacer"></span>
                    @if (puedeOperar()) {
                      <button class="btn sm" [disabled]="busy()" (click)="transferir()"><nx-icon name="shuffle" [size]="14" />Transferir</button>
                      <button class="btn sm danger" [disabled]="busy()" (click)="finalizar()"><nx-icon name="stop" [size]="14" />Finalizar</button>
                    }
                  </div>

                  @if (turnos().length) {
                    <ul class="turnos" aria-label="Conversación simulada">
                      @for (t of turnos(); track $index) {
                        <li class="turno {{ t.rol }}">
                          <span class="who">{{ t.rol === 'usuario' ? 'Usuario' : 'Agente' }}</span>
                          <span class="txt">{{ t.texto }}</span>
                          @if (t.gobierno; as g) {
                            <span class="badge sm {{ gobiernoBadge(g) }}" [title]="g.motivo">Gobierno: {{ g.estado }}</span>
                          }
                        </li>
                      }
                    </ul>
                  }

                  @if (puedeOperar()) {
                    <form class="row" (ngSubmit)="enviarTurno()">
                      <input name="entrada" class="input grow" required placeholder="Escriba lo que diría el interlocutor (STT simulado)" [(ngModel)]="entrada" />
                      <button type="submit" class="btn primary" [disabled]="busy() === 'turno' || !entrada.trim()">
                        {{ busy() === 'turno' ? '…' : 'Enviar turno' }}
                      </button>
                    </form>
                    <p class="hint">
                      Pruebe frases como «quiero hacer un <strong>pago</strong>» o «consultar mi <strong>saldo</strong>»: el
                      simulado propone una acción sensible que pasa por el gobierno (E6) antes de cualquier efecto.
                    </p>
                  } @else {
                    <p class="muted">La llamada está en estado {{ estadoLlamadaMeta(activeCall()!.estado).label }}; no admite más operaciones.</p>
                  }
                  <div class="row">
                    <span class="spacer"></span>
                    <button class="btn" (click)="nuevaLlamada()">Nueva llamada</button>
                  </div>
                </div>
              }
            } @else {
              <div class="callout" role="note"><nx-icon name="lock" [size]="16" /><span>Se necesita rol EDITOR o superior para simular llamadas.</span></div>
            }

            <h3>Historial de llamadas</h3>
            @if (llamadasLoading()) {
              <p class="muted" role="status">Cargando llamadas…</p>
            } @else if (!llamadas().length) {
              <p class="muted">Aún no hay llamadas en esta cuenta.</p>
            } @else {
              <div class="table-wrap">
                <table class="table">
                  <caption class="sr-only">Llamadas de la cuenta</caption>
                  <thead><tr><th scope="col">Estado</th><th scope="col">Dirección</th><th scope="col">Duración</th><th scope="col">Iniciada</th></tr></thead>
                  <tbody>
                    @for (l of llamadas(); track l.id) {
                      <tr>
                        <td><span class="badge {{ estadoLlamadaMeta(l.estado).badge }}">{{ estadoLlamadaMeta(l.estado).label }}</span></td>
                        <td class="small">{{ l.direccion === 'SALIENTE' ? 'Saliente' : 'Entrante' }}</td>
                        <td class="small">{{ l.duracionSeg != null ? l.duracionSeg + ' s' : '—' }}</td>
                        <td class="muted small nowrap" [title]="l.createdAt | date: 'medium'">{{ l.createdAt | ago }}</td>
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
    .danger-text { color: var(--danger); }
    tr.sel { background: var(--primary-50); }
    .badge.sm { height: 18px; font-size: 10px; }
    .caps { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .cap { border: 1px solid var(--border); border-radius: 8px; padding: 10px; }
    .cap-head { font-weight: 600; margin-bottom: 6px; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .req { margin: 6px 0 0; }
    .reqs { border: 1px solid var(--border); border-radius: 8px; padding: 10px; display: flex; flex-wrap: wrap; gap: 14px; }
    .reqs legend { padding: 0 6px; font-size: 12px; color: var(--muted); }
    .check { display: inline-flex; align-items: center; gap: 6px; }
    .check.inline .input.sm { margin-left: 6px; }
    .input.sm { height: 30px; padding: 2px 8px; width: auto; }
    .turnos { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .turno { display: flex; gap: 8px; align-items: baseline; padding: 6px 10px; border-radius: 8px; background: var(--surface-2); }
    .turno.agente { background: var(--primary-50); }
    .turno .who { font-weight: 600; font-size: 11px; min-width: 56px; }
    .turno .txt { flex: 1; min-width: 0; }
    .call-status { align-items: center; }
    ul.tight { margin: 4px 0 0; padding-left: 18px; }
    @media (max-width: 640px) { .grid2 { grid-template-columns: 1fr; } }
  `,
})
export class VozPage implements OnInit {
  private readonly voz = inject(VoiceApi);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly cuentas = signal<VozCuenta[]>([]);
  readonly orgUnits = signal<OrgUnitOption[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal<string | null>(null);

  readonly editor = signal<FormCuenta | null>(null);
  readonly secretError = signal<string | null>(null);

  readonly selectedId = signal<string | null>(null);
  readonly llamadas = signal<VozLlamada[]>([]);
  readonly llamadasLoading = signal(false);

  readonly activeCall = signal<VozLlamada | null>(null);
  readonly turnos = signal<TurnoVista[]>([]);

  readonly isAdmin = this.auth.isAdmin;
  readonly canEdit = this.auth.canEdit;

  readonly proveedores = VOZ_PROVEEDORES;
  readonly estadosCuenta: CanalCuentaEstado[] = ['ACTIVA', 'SUSPENDIDA', 'RETIRADA'];
  readonly capas = VOZ_CAPAS;
  readonly estadoCuentaMeta = estadoCuentaMeta;
  readonly estadoLlamadaMeta = estadoLlamadaMeta;
  readonly capaLabel = capaLabel;
  readonly activacion = (c: VozCuenta) => estadoActivacion(c.proveedor, c.secretRef);
  readonly info = (proveedor: string) => proveedorInfo(proveedor);

  private readonly empresaMap = computed(() => new Map(this.orgUnits().map((u) => [u.id, u.name])));
  readonly selected = computed(() => this.cuentas().find((c) => c.id === this.selectedId()) ?? null);
  readonly activacionEditor = computed(() => {
    const f = this.editor();
    return f ? estadoActivacion(f.proveedor, f.secretRef) : null;
  });
  readonly puedeOperar = computed(() => {
    const c = this.activeCall();
    return !!c && this.canEdit() && llamadaActiva(c.estado);
  });

  // Formulario de inicio de llamada
  readonly direccion = signal<DireccionMensaje>('SALIENTE');
  readonly reqTransferencia = signal(false);
  readonly reqBargeIn = signal(false);
  readonly reqDialogo = signal<VozModoDialogo>('externalDialog');
  numero = '';
  idem = '';
  entrada = '';

  async ngOnInit() {
    void this.loadOrgUnits();
    await this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.cuentas.set(await this.voz.cuentas());
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

  empresaNombre(id: string | null): string {
    if (!id) return '—';
    return this.empresaMap().get(id) ?? `…${id.slice(-6)}`;
  }

  proveedorLegible(p: string): string {
    return proveedorInfo(p)?.legible ?? p;
  }

  capsDeCapa(pi: ReturnType<typeof proveedorInfo>, capa: (typeof VOZ_CAPAS)[number]): readonly string[] {
    if (!pi) return [];
    switch (capa) {
      case 'TELEFONIA': return pi.capabilities.telefonia;
      case 'VOZ': return pi.capabilities.voz;
      case 'DIALOGO': return pi.capabilities.dialogo;
      case 'PROCESOS': return pi.capabilities.procesos;
    }
  }

  reqDeCapa(pi: ReturnType<typeof proveedorInfo>, capa: (typeof VOZ_CAPAS)[number]) {
    return pi?.requisitosActivacion.find((r) => r.capa === capa) ?? null;
  }

  requisitoProblemas(proveedor: string): string[] {
    return validarRequisitosVoz(proveedor, {
      direccion: this.direccion(),
      transferencia: this.reqTransferencia(),
      bargeIn: this.reqBargeIn(),
      dialogo: this.reqDialogo(),
    });
  }

  gobiernoBadge(g: GobiernoLlamada): string {
    return g.estado === 'PERMITIDA' ? 'success' : g.estado === 'DENEGADA' ? 'danger' : 'warning';
  }

  // ---------- Cuentas ----------
  nuevo() {
    this.editor.set({ empresaId: '', proveedor: 'simulado', estado: 'ACTIVA', secretRef: '', config: {} });
    this.secretError.set(null);
  }

  onSecretChange() {
    this.secretError.set(mensajeSecretRef(this.editor()?.secretRef ?? ''));
  }

  formValido(f: FormCuenta): boolean {
    return !!f.empresaId && !!f.proveedor && !this.secretError();
  }

  async guardar() {
    const f = this.editor();
    if (!f || !this.formValido(f)) return;
    const secretRef = f.secretRef.trim();
    this.busy.set('save');
    try {
      await this.voz.createCuenta({
        empresaId: f.empresaId,
        proveedor: f.proveedor,
        estado: f.estado,
        secretRef: secretRef || undefined,
        config: f.config ?? {},
      });
      this.toast.success('Cuenta de voz creada');
      this.editor.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  // ---------- Panel ----------
  seleccionar(c: VozCuenta) {
    this.selectedId.set(c.id);
    this.nuevaLlamada();
    void this.loadLlamadas(c.id);
  }

  cerrarPanel() {
    this.selectedId.set(null);
    this.llamadas.set([]);
    this.activeCall.set(null);
    this.turnos.set([]);
  }

  nuevaLlamada() {
    this.activeCall.set(null);
    this.turnos.set([]);
    this.direccion.set('SALIENTE');
    this.reqTransferencia.set(false);
    this.reqBargeIn.set(false);
    this.reqDialogo.set('externalDialog');
    this.numero = '';
    this.entrada = '';
    this.idem = nuevaIdempotencyKey();
  }

  regenerarIdem() {
    this.idem = nuevaIdempotencyKey();
  }

  private async loadLlamadas(cuentaId: string) {
    this.llamadasLoading.set(true);
    try {
      this.llamadas.set(await this.voz.llamadas(cuentaId));
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.llamadasLoading.set(false);
    }
  }

  async iniciarLlamada(c: VozCuenta) {
    if (!this.numero.trim() || !this.idem.trim() || this.requisitoProblemas(c.proveedor).length) return;
    this.busy.set('iniciar');
    try {
      const call = await this.voz.iniciar({
        cuentaId: c.id,
        direccion: this.direccion(),
        numero: this.numero.trim(),
        idempotencyKey: this.idem.trim(),
        requisitos: {
          transferencia: this.reqTransferencia() || undefined,
          bargeIn: this.reqBargeIn() || undefined,
          dialogo: this.reqDialogo(),
        },
      });
      this.activeCall.set(call);
      this.turnos.set([]);
      const meta = estadoLlamadaMeta(call.estado);
      if (call.estado === 'FALLIDA') this.toast.error(`Llamada ${meta.label}`);
      else this.toast.success(`Llamada ${meta.label}`);
      await this.loadLlamadas(c.id);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  async enviarTurno() {
    const call = this.activeCall();
    if (!call || !this.entrada.trim()) return;
    const texto = this.entrada.trim();
    this.busy.set('turno');
    try {
      const res = await this.voz.turno(call.id, { entrada: texto, bargeIn: this.reqBargeIn() || undefined });
      this.turnos.update((t) => [
        ...t,
        { rol: 'usuario', texto },
        { rol: 'agente', texto: res.respuesta ?? '(sin respuesta)', gobierno: res.gobierno },
      ]);
      this.activeCall.set({ ...call, estado: res.estado });
      this.entrada = '';
      if (res.gobierno) {
        const g = res.gobierno;
        if (g.estado === 'DENEGADA') this.toast.error(`Acción ${g.tipoAccion} denegada: ${g.motivo}`);
        else if (g.estado === 'REQUIERE_APROBACION') this.toast.info(`Acción ${g.tipoAccion} requiere aprobación`);
      }
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  async transferir() {
    const call = this.activeCall();
    if (!call) return;
    const destino = prompt('Destino de la transferencia (cola/extensión/número):', 'cola-humanos');
    if (!destino?.trim()) return;
    this.busy.set('transferir');
    try {
      const res = await this.voz.transferir(call.id, { destino: destino.trim() });
      if (res.respuesta) this.turnos.update((t) => [...t, { rol: 'agente', texto: res.respuesta! }]);
      this.activeCall.set({ ...call, estado: res.estado });
      this.toast.success('Llamada transferida a humano');
      await this.refrescarLlamadas();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  async finalizar() {
    const call = this.activeCall();
    if (!call) return;
    this.busy.set('finalizar');
    try {
      const res = await this.voz.finalizar(call.id);
      if (res.respuesta) this.turnos.update((t) => [...t, { rol: 'agente', texto: res.respuesta! }]);
      this.activeCall.set({ ...call, estado: res.estado, duracionSeg: res.duracionSeg });
      this.toast.success('Llamada finalizada');
      await this.refrescarLlamadas();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  private async refrescarLlamadas() {
    const id = this.selectedId();
    if (id) await this.loadLlamadas(id);
  }
}
