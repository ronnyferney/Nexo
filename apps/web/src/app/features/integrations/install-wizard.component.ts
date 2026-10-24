import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DOCUMENT,
  ElementRef,
  inject,
  input,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { IntegrationsApi } from '../../core/integrations.api';
import { PlatformApi } from '../../core/platform.api';
import type { CatalogAuthMethod, CatalogEntry } from '../../core/integrations.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { isHttpUrl } from '../../shared/safe-url';
import { BrandLogoComponent } from './brand-logo.component';
import { AUTH_METHOD_META, categoryLabel } from './catalog-meta';

/** Asistente de instalación de una integración del catálogo (ADR 0005 D2) sobre un `<dialog>` modal. */
@Component({
  selector: 'nx-install-wizard',
  imports: [FormsModule, IconComponent, BrandLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="modal" aria-labelledby="iw-title" (cancel)="onCancel($event)" (close)="closed.emit()">
      @let e = entry();
      <form (ngSubmit)="submit()" #f="ngForm">
        <div class="modal-head">
          <nx-brand-logo [entry]="e" [size]="40" />
          <div class="grow">
            <h2 id="iw-title">Instalar {{ e.name }}</h2>
            <span class="muted small">{{ category(e) }} · {{ e.operations.length }} {{ e.operations.length === 1 ? 'operación incluida' : 'operaciones incluidas' }}</span>
          </div>
          <button type="button" class="btn ghost icon" aria-label="Cerrar" title="Cerrar" (click)="close()"><nx-icon name="x" /></button>
        </div>

        <div class="modal-body">
          <div class="field">
            <label for="iw-name">Nombre del conector</label>
            <input id="iw-name" name="name" class="input" autofocus required minlength="2" [(ngModel)]="name" autocomplete="off" />
            <span class="hint">Así lo verán sus agentes y flujos. Puede instalar varias cuentas con nombres distintos.</span>
          </div>

          @if (e.authMethods.length > 1) {
            <fieldset class="methods">
              <legend>Método de autenticación</legend>
              @for (m of e.authMethods; track m) {
                <label class="choice">
                  <input type="radio" name="authMethod" [value]="m" [ngModel]="method()" (ngModelChange)="method.set($event)" />
                  <span><strong>{{ meta[m].label }}</strong><span class="muted small block">{{ meta[m].description }}</span></span>
                </label>
              }
            </fieldset>
          }

          @if (method() === 'oauth2_code') {
            @if (e.platformApp?.available) {
              <p class="small muted app-line"><nx-icon name="shield" [size]="14" />
                Inicio de sesión gestionado por Nexo. No necesita registrar nada ni copiar claves.</p>
            } @else {
              <div class="callout warning" role="alert"><nx-icon name="alert" [size]="16" />
                <div class="grow"><p style="margin:0">Esta integración aún no tiene configurada su app de inicio de sesión.</p>
                  @if (platform.isPlatformAdmin()) {
                    <button type="button" class="btn sm" style="margin-top:8px" (click)="goToConsole()">
                      <nx-icon name="plug" [size]="14" />Configurarla ahora</button>
                  } @else {
                    <p class="small" style="margin:4px 0 0">Pida a un administrador de Nexo que la configure una vez en
                      <strong>Consola de plataforma → Apps de inicio de sesión</strong>.</p>
                  }
                </div></div>
            }
          }

          @for (fl of visibleFields(); track fl.key) {
            <div class="field">
              <label [for]="'iw-' + fl.key">{{ fl.label }}@if (!fl.required && !fl.label.toLowerCase().includes('opcional')) { <span class="muted"> (opcional)</span> }</label>
              <div class="secret-row">
                <input class="input" [class.mono]="fl.secret" [id]="'iw-' + fl.key" [name]="'cred_' + fl.key"
                  [type]="fl.secret && !revealed()[fl.key] ? 'password' : 'text'" [required]="fl.required"
                  [autocomplete]="fl.secret ? 'new-password' : 'off'" spellcheck="false" data-lpignore="true" data-1p-ignore
                  [attr.aria-describedby]="fl.help ? 'iw-h-' + fl.key : null"
                  [pattern]="fl.pattern ?? ''" #ctl="ngModel"
                  [ngModel]="credentials()[fl.key] ?? ''" (ngModelChange)="setCredential(fl.key, $event)" />
                @if (fl.secret) {
                  <button type="button" class="btn icon" [attr.aria-label]="revealed()[fl.key] ? 'Ocultar valor' : 'Mostrar valor'"
                    [title]="revealed()[fl.key] ? 'Ocultar valor' : 'Mostrar valor'" [attr.aria-pressed]="!!revealed()[fl.key]" (click)="toggleReveal(fl.key)">
                    <nx-icon name="eye" [size]="16" /></button>
                }
              </div>
              @if (fl.help) { <span class="hint" [id]="'iw-h-' + fl.key">{{ fl.help }}</span> }
              @if (ctl.errors?.['pattern'] && ctl.dirty) { <span class="error-text" role="alert">El valor no tiene el formato esperado.</span> }
            </div>
          }

          @if (hasSecrets()) {
            <div class="callout info"><nx-icon name="lock" [size]="16" />
              <span>Las credenciales se guardan <strong>cifradas (AES-256-GCM) en la bóveda de secretos</strong> del workspace.
                El conector solo guarda una referencia y nunca se muestran de nuevo.</span></div>
          }
          @if (method() === 'oauth2_code') {
            <div class="callout info"><nx-icon name="externalLink" [size]="16" />
              <span>Lo llevaremos a iniciar sesión y autorizar el acceso; luego volverá a Nexo con la cuenta conectada.</span></div>
          }
          @if (conflict()) {
            <div class="callout warning" role="alert"><nx-icon name="lock" [size]="16" />
              <div><strong>Las credenciales de {{ e.name }} ya están en la bóveda</strong>
                <p class="conflict-text">{{ conflict() }}.</p>
                <p class="conflict-text">Para instalar otra instancia con la misma cuenta, use exactamente las mismas credenciales. Para cambiarlas,
                  pida a un administrador del workspace que las reemplace en Administración › Seguridad › Secretos o que haga la instalación.</p></div></div>
          } @else if (error()) { <div class="callout danger" role="alert">{{ error() }}</div> }
        </div>

        <div class="modal-foot">
          @if (isHttp(e.docsUrl)) {
            <a class="btn ghost docs" [href]="e.docsUrl" target="_blank" rel="noopener noreferrer"><nx-icon name="book" [size]="16" />Documentación</a>
          }
          <button type="button" class="btn" (click)="close()">Cancelar</button>
          <button type="submit" class="btn primary"
            [disabled]="busy() || f.invalid || (method() === 'oauth2_code' && !e.platformApp?.available)">
            <nx-icon [name]="method() === 'oauth2_code' ? 'externalLink' : 'check'" [size]="16" />
            {{ busy() ? 'Instalando…' : method() === 'oauth2_code' ? 'Instalar y conectar' : 'Instalar' }}
          </button>
        </div>
      </form>
    </dialog>
  `,
  styles: `
    .app-line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 0; }
    .link { background: none; border: 0; padding: 0; color: var(--primary); font: inherit; cursor: pointer; text-decoration: underline; }
    .grow { flex: 1; min-width: 0; }
    .methods { border: 0; margin: 0; padding: 0; display: grid; gap: 8px; }
    .methods legend { font-size: 12.5px; font-weight: 600; color: var(--muted); margin-bottom: 6px; padding: 0; }
    .secret-row { display: flex; gap: 6px; }
    .secret-row .btn { height: auto; flex-shrink: 0; }
    .docs { margin-right: auto; }
    .conflict-text { margin: 4px 0 0; }
  `,
})
export class InstallWizardComponent implements OnInit {
  private readonly api = inject(IntegrationsApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);
  protected readonly platform = inject(PlatformApi);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  readonly entry = input.required<CatalogEntry>();
  readonly closed = output<void>();

  readonly meta = AUTH_METHOD_META;
  readonly method = signal<CatalogAuthMethod>('apiKey');
  readonly credentials = signal<Partial<Record<string, string>>>({});
  readonly revealed = signal<Record<string, boolean>>({});
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  /** 409 de la API: un EDITOR intentó reemplazar credenciales ya guardadas en la bóveda (solo ADMIN/OWNER puede). */
  readonly conflict = signal<string | null>(null);
  name = '';

  /** Campos visibles para el método elegido (si la API los etiqueta con `authMethods`). */
  readonly fields = computed(() =>
    this.entry().credentialFields.filter((f) => !f.authMethods?.length || f.authMethods.includes(this.method())),
  );
  readonly hasSecrets = computed(() => this.visibleFields().some((f) => f.secret));
  /** OAuth: los campos opcionales son la app propia (client ID/secret); quedan ocultos salvo que se pidan. */
  /**
   * OAuth: nunca se muestran los campos de app propia (client ID/secret). El inicio de sesión lo gestiona Nexo con la
   * app de la plataforma; así el navegador no puede autocompletarlos con valores ajenos y el usuario no ve nada técnico.
   */
  readonly visibleFields = computed(() =>
    this.method() === 'oauth2_code' ? [] : this.fields(),
  );

  constructor() {
    afterNextRender(() => this.dialog().nativeElement.showModal());
  }

  ngOnInit() {
    const e = this.entry();
    this.name = e.name;
    this.method.set(e.authMethods[0] ?? 'apiKey');
    const defaults: Record<string, string> = {};
    for (const f of e.credentialFields) if (f.default && !f.secret) defaults[f.key] = f.default;
    this.credentials.set(defaults);
  }

  category = (e: CatalogEntry) => categoryLabel(e.category);
  isHttp = isHttpUrl;

  setCredential(key: string, value: string) {
    this.credentials.update((c) => ({ ...c, [key]: value }));
  }

  toggleReveal(key: string) {
    this.revealed.update((r) => ({ ...r, [key]: !r[key] }));
  }

  goToConsole() {
    this.close();
    void this.router.navigate(['/platform/oauth-apps']);
  }

  onCancel(ev: Event) {
    if (this.busy()) ev.preventDefault();
  }

  close() {
    if (!this.busy()) this.dialog().nativeElement.close();
  }

  async submit() {
    const e = this.entry();
    const keys = new Set(this.visibleFields().map((f) => f.key));
    const credentials: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.credentials())) if (keys.has(k) && v?.trim()) credentials[k] = v.trim();
    this.busy.set(true);
    this.error.set(null);
    this.conflict.set(null);
    try {
      const res = await this.api.install(e.id, { name: this.name.trim() || undefined, authMethod: this.method(), credentials });
      if (this.method() === 'oauth2_code' && isHttpUrl(res.authorizeUrl)) {
        this.toast.info(`Conector creado. Redirigiendo a ${e.name} para autorizar el acceso…`);
        this.document.location.assign(res.authorizeUrl);
        return;
      }
      this.toast.success(`${e.name} instalado`);
      this.busy.set(false);
      this.dialog().nativeElement.close();
      await this.router.navigate(['/connectors', res.id]);
    } catch (err) {
      const msg = errorMessage(err);
      if (err instanceof HttpErrorResponse && err.status === 409) this.conflict.set(msg.replace(/\.\s*$/, ''));
      else this.error.set(msg);
      this.busy.set(false);
    }
  }
}
