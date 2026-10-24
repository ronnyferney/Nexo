import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DOCUMENT,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { IntegrationsApi } from '../../core/integrations.api';
import type { CatalogAccount, ConnectorUsage } from '../../core/integrations.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { isHttpUrl } from '../../shared/safe-url';
import { AccountConfirmComponent, type AccountAction } from './account-confirm.component';
import { BrandLogoComponent } from './brand-logo.component';
import { AUTH_METHOD_META, categoryLabel, type CatalogEntryView } from './catalog-meta';
import { oauthProvider } from './integration-logos';

/** Panel lateral de detalle de una integración del catálogo (`<dialog>` modal: foco atrapado, Escape cierra). */
@Component({
  selector: 'nx-integration-detail',
  imports: [RouterLink, IconComponent, BrandLogoComponent, AccountConfirmComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="modal drawer" aria-labelledby="idt-title" aria-describedby="idt-desc" (close)="closed.emit()">
      @let e = entry();
      <div class="modal-head">
        <span class="spacer"></span>
        <button type="button" class="btn ghost icon" aria-label="Cerrar detalle" title="Cerrar" (click)="close()"><nx-icon name="x" /></button>
      </div>
      <div class="modal-body">
        <div class="hero">
          <nx-brand-logo [entry]="e" [size]="64" />
          <div class="grow">
            <h2 id="idt-title">{{ e.name }}</h2>
            <div class="chips">
              <span class="badge">{{ category() }}</span>
              @if (e.verified === false) {
                <span class="badge warning" title="Endpoints pendientes de verificar contra la documentación oficial">Sin verificar</span>
              } @else if (e.verified) {
                <span class="badge info"><nx-icon name="shield" [size]="12" />Verificada</span>
              }
              @if (e.installed - (e.pendingAuth || 0) > 0) {
                <span class="badge success"><nx-icon name="check" [size]="12" />{{ e.installed - (e.pendingAuth || 0) }} {{ e.installed - (e.pendingAuth || 0) === 1 ? 'conectada' : 'conectadas' }}</span>
              }
              @if (e.pendingAuth) {
                <span class="badge warning"><nx-icon name="alert" [size]="12" />{{ e.pendingAuth }} pendiente{{ e.pendingAuth === 1 ? '' : 's' }} de conectar</span>
              }
            </div>
          </div>
        </div>
        <p id="idt-desc" class="desc">{{ e.description }}</p>
        @if (e.installed) {
          <section aria-labelledby="idt-accounts">
            <h3 id="idt-accounts">Cuentas</h3>
            <ul class="accounts">
              @for (acc of accounts(); track acc.connectorId) {
                <li>
                  <span class="dot" [class.ok]="acc.connected" aria-hidden="true"></span>
                  <span class="grow">
                    <strong>{{ acc.accountLabel || acc.name }}</strong>
                    <span class="muted small block">{{ acc.connected ? 'Conectada' : 'Sin conectar: los agentes no pueden usarla' }}</span>
                  </span>
                  @if (auth.canEdit()) {
                    @if (acc.oauth) {
                      <button type="button" class="btn sm" [class.primary]="!acc.connected" [disabled]="!!busy()" (click)="connect(acc)">
                        <nx-icon [name]="acc.connected ? 'refresh' : 'link'" [size]="14" />{{ acc.connected ? 'Reconectar' : 'Conectar' }}</button>
                    }
                    @if (acc.oauth && acc.connected) {
                      <button type="button" class="btn sm danger" [disabled]="!!busy()" (click)="disconnect(acc)">
                        <nx-icon name="unlink" [size]="14" />Desconectar</button>
                    } @else {
                      <button type="button" class="btn sm ghost danger" [disabled]="!!busy()" (click)="remove(acc)"
                        [attr.aria-label]="'Eliminar ' + (acc.accountLabel || acc.name)" title="Eliminar"><nx-icon name="trash" [size]="14" /></button>
                    }
                  }
                </li>
              } @empty {
                <li class="muted small">Cargando cuentas…</li>
              }
              @if (auth.canEdit()) {
                <li><button type="button" class="btn ghost sm add" (click)="install.emit()"><nx-icon name="plus" [size]="14" />Agregar otra cuenta</button></li>
              }
            </ul>
          </section>
        }

        <section aria-labelledby="idt-auth">
          <h3 id="idt-auth">Autenticación</h3>
          <ul class="plain">
            @for (m of e.authMethods; track m) {
              <li class="item"><nx-icon [name]="m === 'oauth2_code' ? 'user' : m === 'mcp' ? 'server' : 'key'" [size]="16" />
                <span><strong>{{ m === 'oauth2_code' ? 'Iniciar sesión con ' + provider() : meta[m].label }}</strong>
                  <span class="muted small block">{{ meta[m].description }}</span></span></li>
            }
          </ul>
        </section>

        <section aria-labelledby="idt-ops">
          <h3 id="idt-ops">Operaciones <span class="badge">{{ e.operations.length }}</span></h3>
          @if (e.operations.length) {
            <ul class="plain ops">
              @for (op of e.operations; track op.key) {
                <li>
                  <div class="op-head"><strong>{{ op.name }}</strong>
                    @if (op.write) { <span class="badge warning" title="Crea o modifica datos en {{ e.name }}">Escritura</span> }
                    @else if (op.write === false) { <span class="badge">Lectura</span> }</div>
                  <span class="muted small">{{ op.description }}</span>
                </li>
              }
            </ul>
          } @else {
            <p class="muted small">Las operaciones se descubren automáticamente del servidor al instalar.</p>
          }
        </section>

        @if (e.verificationNotes) {
          <details class="notes">
            <summary>Notas de verificación</summary>
            <p class="small muted">{{ e.verificationNotes }}</p>
          </details>
        }
      </div>
      <div class="modal-foot">
        @if (isHttp(e.docsUrl)) {
          <a class="btn ghost docs" [href]="e.docsUrl" target="_blank" rel="noopener noreferrer"><nx-icon name="book" [size]="16" />Documentación<span class="sr-only"> (abre en otra pestaña)</span></a>
        }
        @if (e.installed) {
          <a class="btn" routerLink="/connectors" (click)="close()"><nx-icon name="plug" [size]="16" />Mis conectores</a>
        }
        @if (auth.canEdit()) {
          <button type="button" class="btn primary" (click)="install.emit()">
            <nx-icon name="plus" [size]="16" />{{ e.installed ? 'Instalar otra cuenta' : 'Instalar' }}</button>
        } @else {
          <span class="small muted">Solo un editor puede instalar integraciones.</span>
        }
      </div>
    </dialog>
    @if (pending(); as p) {
      <nx-account-confirm [name]="p.acc.accountLabel || p.acc.name" [action]="p.action" [usage]="p.usage"
        [busy]="busy() === p.acc.connectorId" (confirmed)="confirmPending()" (cancelled)="pending.set(null)" />
    }
  `,
  styles: `
    dialog.drawer { margin: 0 0 0 auto; height: 100dvh; max-height: 100dvh; width: min(480px, 100vw); max-width: 100vw; border-radius: var(--radius) 0 0 var(--radius); display: none; flex-direction: column; }
    dialog.drawer[open] { display: flex; }
    .modal-head { border-bottom: 0; padding: 10px 12px 0; }
    .modal-body { flex: 1; overflow-y: auto; padding-top: 0; gap: 18px; }
    .hero { display: flex; gap: 16px; align-items: center; }
    .hero h2 { font-size: 20px; margin-bottom: 6px; overflow-wrap: anywhere; }
    .grow { flex: 1; min-width: 0; }
    .desc { margin: 0; line-height: 1.6; }
    h3 { display: flex; align-items: center; gap: 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin-bottom: 8px; }
    .plain { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .item { display: flex; gap: 10px; align-items: flex-start; }
    .item nx-icon { color: var(--primary); margin-top: 2px; }
    .ops li { display: grid; gap: 2px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
    .ops li:last-child { border-bottom: 0; }
    .op-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .accounts { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius); }
    .accounts li { display: flex; gap: 10px; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--border); }
    .accounts li:last-child { border-bottom: 0; }
    .accounts .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--warning); flex-shrink: 0; }
    .accounts .dot.ok { background: var(--success); }
    .accounts .add { margin-left: -6px; }
    .notes summary { cursor: pointer; color: var(--primary); font-weight: 550; }
    .notes p { margin: 8px 0 0; overflow-wrap: anywhere; }
    .docs { margin-right: auto; }
    @media (max-width: 520px) { dialog.drawer { border-radius: 0; } }
    @media (prefers-reduced-motion: no-preference) { dialog.drawer[open] { animation: slide 0.18s ease-out; } }
    @keyframes slide { from { transform: translateX(24px); opacity: 0.6; } }
  `,
})
export class IntegrationDetailComponent {
  protected readonly auth = inject(AuthService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  readonly entry = input.required<CatalogEntryView>();
  readonly closed = output<void>();
  /** El usuario pidió instalar: la página cierra el panel y abre el asistente de instalación. */
  readonly install = output<void>();

  private readonly api = inject(IntegrationsApi);
  private readonly toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);
  /** Cuentas de esta integración; cambió algo (desconectar/eliminar) → la galería recarga el estado. */
  readonly changed = output<void>();
  readonly accounts = signal<CatalogAccount[]>([]);
  readonly busy = signal<string | null>(null);

  readonly meta = AUTH_METHOD_META;
  readonly category = computed(() => categoryLabel(this.entry().category));
  readonly provider = computed(() => oauthProvider(this.entry()));
  isHttp = isHttpUrl;

  constructor() {
    afterNextRender(() => {
      this.dialog().nativeElement.showModal();
      if (this.entry().installed) void this.loadAccounts();
    });
  }

  async loadAccounts() {
    try {
      this.accounts.set(await this.api.catalogAccounts(this.entry().id));
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async connect(acc: CatalogAccount) {
    this.busy.set(acc.connectorId);
    try {
      const { authorizeUrl } = await this.api.oauthStart(acc.connectorId);
      if (!isHttpUrl(authorizeUrl)) throw new Error('La API devolvió una URL de autorización no válida');
      this.document.location.assign(authorizeUrl);
    } catch (e) {
      this.toast.error(errorMessage(e));
      this.busy.set(null);
    }
  }

  /** Confirmación en curso: primero se consulta qué agentes y flujos usan la cuenta. */
  readonly pending = signal<{ acc: CatalogAccount; action: AccountAction; usage: ConnectorUsage | null } | null>(null);

  disconnect(acc: CatalogAccount) {
    void this.ask(acc, 'disconnect');
  }

  remove(acc: CatalogAccount) {
    void this.ask(acc, 'remove');
  }

  private async ask(acc: CatalogAccount, action: AccountAction) {
    this.pending.set({ acc, action, usage: null });
    try {
      const usage = await this.api.connectorUsage(acc.connectorId);
      if (this.pending()?.acc.connectorId === acc.connectorId) this.pending.set({ acc, action, usage });
    } catch (e) {
      this.pending.set(null);
      this.toast.error(errorMessage(e));
    }
  }

  async confirmPending() {
    const p = this.pending();
    if (!p) return;
    if (p.action === 'remove') await this.run(p.acc, () => this.api.removeConnector(p.acc.connectorId), 'Cuenta eliminada');
    else await this.run(p.acc, () => this.api.oauthDisconnect(p.acc.connectorId), 'Cuenta desconectada');
    this.pending.set(null);
  }

  private async run(acc: CatalogAccount, action: () => Promise<unknown>, done: string) {
    this.busy.set(acc.connectorId);
    try {
      await action();
      this.toast.success(done);
      await this.loadAccounts();
      this.changed.emit();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  close() {
    this.dialog().nativeElement.close();
  }
}
