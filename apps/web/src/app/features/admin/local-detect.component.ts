import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { LlmProvidersApi } from '../../core/llm-providers.api';
import type { DetectedModel, ProviderConnectResult, ProviderMechanism, ProviderView } from '../../core/llm-providers.models';
import { IconComponent } from '../../shared/icon.component';
import { formatContext } from './provider-meta';

/**
 * Detección de un servidor local (Ollama, LM Studio): `POST …/detect` lista los modelos instalados, el usuario
 * elige cuáles habilitar y se crea la conexión con `POST …/connect` (`fields.baseUrl` + `models`).
 */
@Component({
  selector: 'nx-local-detect',
  imports: [FormsModule, RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = provider();
    @if (!found()) {
      <form class="ld" (ngSubmit)="detect()" novalidate>
        <div class="field">
          <label for="ld-url">Dirección del servidor <span class="opt">(opcional)</span></label>
          <input id="ld-url" name="baseUrl" class="input mono" type="url" inputmode="url" spellcheck="false" autocomplete="off"
            [placeholder]="placeholder()" [ngModel]="baseUrl()" (ngModelChange)="baseUrl.set($event); error.set(null)" aria-describedby="ld-url-help" />
          <span id="ld-url-help" class="hint">Déjela vacía para usar la dirección habitual ({{ placeholder() }}).</span>
        </div>
        <button type="submit" class="btn primary pill wide" [disabled]="busy() || !mechanism().available">
          @if (busy() === 'detect') { <span class="spin" aria-hidden="true"></span>Buscando {{ p.name }}… }
          @else { <nx-icon name="search" [size]="16" />{{ mechanism().label || 'Detectar en este servidor' }} }
        </button>
      </form>
      @if (error(); as err) {
        <div class="callout danger" role="alert" tabindex="-1"><nx-icon name="alert" [size]="16" /><span>{{ err }}</span></div>
        <div class="help">
          <strong>¿Su servidor está en su equipo o en una red privada?</strong>
          <ul>
            <li>Nexo se ejecuta en la nube y no alcanza <code>localhost</code> ni direcciones internas. Instale
              <a routerLink="/admin/edges">Nexo Edge</a> en un equipo de esa red para conectarlo de forma segura.</li>
            <li>O indique una dirección accesible desde Internet, con HTTPS y autenticación.</li>
            <li>Revise que {{ p.name }} esté en ejecución y acepte conexiones externas.</li>
          </ul>
        </div>
      }
    } @else {
      <div class="ld">
        <p class="lead" role="status">
          @if (models().length) { Encontramos {{ models().length }} {{ models().length === 1 ? 'modelo' : 'modelos' }} en <code>{{ found() }}</code>. Elija cuáles habilitar. }
          @else { {{ p.name }} respondió en <code>{{ found() }}</code>, pero no tiene modelos instalados. Descargue uno y vuelva a detectar. }
        </p>
        @if (models().length) {
          <fieldset class="found">
            <legend class="sr-only">Modelos encontrados</legend>
            @for (m of models(); track m.id) {
              <label class="choice">
                <input type="checkbox" [checked]="selected().has(m.id)" (change)="toggle(m.id)" />
                <span class="grow"><strong>{{ m.label || m.id }}</strong>
                  <span class="muted small block"><code>{{ m.id }}</code>@if (meta(m); as x) { · {{ x }} }</span></span>
              </label>
            }
          </fieldset>
          <div class="field">
            <label for="ld-name">Nombre de la conexión <span class="opt">(opcional)</span></label>
            <input id="ld-name" class="input" [placeholder]="p.name" [ngModel]="name()" (ngModelChange)="name.set($event)" />
          </div>
        }
        @if (error(); as err) { <div class="callout danger" role="alert"><nx-icon name="alert" [size]="16" /><span>{{ err }}</span></div> }
        <div class="row-btns">
          <button type="button" class="btn pill" (click)="reset()"><nx-icon name="refresh" [size]="15" />Detectar de nuevo</button>
          @if (models().length) {
            <button type="button" class="btn primary pill" [disabled]="!selected().size || !!busy()" (click)="connect()">
              @if (busy() === 'connect') { <span class="spin" aria-hidden="true"></span>Conectando… } @else { Conectar {{ selected().size }} {{ selected().size === 1 ? 'modelo' : 'modelos' }} }
            </button>
          }
        </div>
      </div>
    }
  `,
  styles: `
    :host, .ld { display: flex; flex-direction: column; gap: 14px; }
    .lead { margin: 0; color: var(--muted); line-height: 1.55; overflow-wrap: anywhere; }
    .opt { color: var(--muted); font-weight: 500; }
    .pill { border-radius: 999px; height: 40px; padding: 0 18px; }
    .wide { width: 100%; justify-content: center; }
    .help { background: var(--surface-2); border-radius: 12px; padding: 12px 16px; font-size: 13px; }
    .help ul { margin: 6px 0 0; padding-left: 18px; display: grid; gap: 4px; }
    .found { border: 0; margin: 0; padding: 0; display: grid; gap: 6px; max-height: 260px; overflow-y: auto; }
    .grow { flex: 1; min-width: 0; }
    .block { display: block; }
    code { overflow-wrap: anywhere; }
    .row-btns { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; }
    .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.4); border-top-color: #fff; animation: spin 0.7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 480px) { .row-btns .btn { flex: 1 1 auto; justify-content: center; } }
    @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
  `,
})
export class LocalDetectComponent implements OnInit {
  private readonly api = inject(LlmProvidersApi);

  readonly provider = input.required<ProviderView>();
  readonly mechanism = input.required<ProviderMechanism>();
  readonly autostart = input(false);
  readonly connected = output<ProviderConnectResult>();

  readonly baseUrl = signal('');
  readonly name = signal('');
  readonly busy = signal<'detect' | 'connect' | null>(null);
  readonly error = signal<string | null>(null);
  readonly found = signal<string | null>(null);
  readonly models = signal<DetectedModel[]>([]);
  readonly selected = signal<ReadonlySet<string>>(new Set());

  readonly placeholder = computed(() => {
    const f = (this.provider().fields ?? []).find((x) => /url/i.test(x.key));
    return f?.default || f?.placeholder || (this.provider().id.includes('lmstudio') ? 'http://localhost:1234/v1' : 'http://localhost:11434');
  });

  ngOnInit() {
    if (this.autostart() && this.mechanism().available) void this.detect();
  }

  async detect() {
    if (this.busy()) return;
    this.busy.set('detect');
    this.error.set(null);
    try {
      const r = await this.api.detect(this.provider().id, this.baseUrl().trim() || undefined);
      if (r.reachable === false) {
        this.error.set(r.message || `No se pudo conectar con ${r.baseUrl || this.placeholder()}.`);
        return;
      }
      const list = (r.models ?? []).map((m) => (typeof m === 'string' ? { id: m } : m)).filter((m) => !!m?.id);
      this.models.set(list);
      this.selected.set(new Set(list.map((m) => m.id)));
      this.found.set(r.baseUrl || this.baseUrl().trim() || this.placeholder());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  reset() {
    this.found.set(null);
    this.models.set([]);
    this.error.set(null);
  }

  toggle(id: string) {
    this.selected.update((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  }

  meta(m: DetectedModel) {
    const parts: string[] = [];
    const ctx = formatContext(m.contextTokens);
    if (ctx) parts.push(`${ctx} de contexto`);
    if (m.sizeBytes) parts.push(`${(m.sizeBytes / 1e9).toFixed(1)} GB`);
    return parts.join(' · ') || null;
  }

  async connect() {
    const baseUrl = this.found();
    if (!baseUrl || !this.selected().size) return;
    this.busy.set('connect');
    this.error.set(null);
    try {
      const key = (this.provider().fields ?? []).find((x) => /url/i.test(x.key))?.key ?? 'baseUrl';
      const res = await this.api.connect(this.provider().id, {
        ...(this.name().trim() ? { name: this.name().trim() } : {}),
        fields: { [key]: baseUrl },
        models: [...this.selected()],
      });
      this.connected.emit(res);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }
}
