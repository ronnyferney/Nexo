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
                    @if (!acc.connected && acc.app; as app) {
                      <span class="small block" [class.warn-text]="app.kind !== 'platform'">
                        @if (app.problem) { {{ app.problem }} }
                        @else { App {{ app.kind === 'own' ? 'propia' : 'de Nexo' }} · client ID <code>{{ app.clientIdHint }}</code> }
                      </span>
                    }
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
                @if (accountsState() === 'loading') { <li class="muted small" role="status">Cargando cuentas…</li> }
                @else if (accountsState() === 'error') {
                  <li class="small"><span class="grow">No se pudieron cargar las cuentas.</span>
                    <button type="button" class="btn sm" (click)="loadAccounts()">Reintentar</button></li>
                } @else { <li class="muted small">Aún no hay cuentas conectadas.</li> }
              }
              @if (auth.canEdit()) {
                <li><button type="button" class="btn ghost sm add" (click)="install.emit()"><nx-icon name="plus" [size]="14" />Agregar otra cuenta</button></li>
              }
            </ul>
          </section>
        }

        <section aria-labelledby="idt-ops">
          <h3 id="idt-ops">Qué pueden hacer sus agentes</h3>
          @if (e.operations.length) {
            @if (reads().length) {
              <div class="caps"><span class="cap-label">Lee</span>
                @for (op of reads(); track op.key) { <span class="chip" [title]="op.description">{{ op.name }}</span> }</div>
            }
            @if (writes().length) {
              <div class="caps"><span class="cap-label warn" title="Crea o modifica datos en {{ e.name }}">Modifica</span>
                @for (op of writes(); track op.key) { <span class="chip" [title]="op.description">{{ op.name }}</span> }</div>
            }
          } @else {
            <p class="muted small">Las operaciones se descubren del servidor al instalar.</p>
          }
          <p class="muted small access"><nx-icon [name]="e.authMethods[0] === 'oauth2_code' ? 'user' : 'key'" [size]="14" />
            {{ e.authMethods[0] === 'oauth2_code' ? 'Acceso: iniciar sesión con ' + provider() : 'Acceso: ' + meta[e.authMethods[0]].label }}</p>
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
        @if (!auth.canEdit()) {
          <span class="small muted">Solo un editor puede instalar apps.</span>
        } @else if (!e.installed) {
          <button type="button" class="btn primary" (click)="install.emit()"><nx-icon name="plus" [size]="16" />Instalar</button>
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
    .accounts { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius); }
    .accounts li { display: flex; gap: 10px; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--border); }
    .accounts li:last-child { border-bottom: 0; }
    .accounts .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--warning); flex-shrink: 0; }
    .accounts .dot.ok { background: var(--success); }
    .accounts .add { margin-left: -6px; }
    .warn-text { color: var(--warning); }
    .caps { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }
    .cap-label { font-size: 12px; font-weight: 600; color: var(--muted); min-width: 64px; }
    .cap-label.warn { color: var(--warning); }
    .chip { font-size: 12.5px; padding: 3px 10px; border-radius: 999px; background: var(--surface-2, var(--bg)); border: 1px solid var(--border); cursor: help; }
    .access { display: flex; align-items: center; gap: 6px; margin: 4px 0 0; }
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
  readonly accountsState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly reads = computed(() => this.entry().operations.filter((o) => !o.write));
  readonly writes = computed(() => this.entry().operations.filter((o) => o.write));
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
    this.accountsState.set('loading');
    try {
      this.accounts.set(await this.api.catalogAccounts(this.entry().id));
      this.accountsState.set('ready');
    } catch {
      this.accountsState.set('error');
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
