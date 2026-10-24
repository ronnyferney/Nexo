import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.service';
import { LlmProvidersApi } from '../../core/llm-providers.api';
import type {
  KeylessMechanism,
  KeylessSetup,
  ProviderConnectResult,
  ProviderField,
  ProviderMechanism,
  ProviderView,
} from '../../core/llm-providers.models';
import { TIER_LABELS } from '../../shared/budget';
import { IconComponent } from '../../shared/icon.component';
import { isHttpUrl } from '../../shared/safe-url';
import { fieldsFor, isRequired } from './provider-meta';

/**
 * Conexión sin claves de la familia Claude:
 * - «Federación de identidad» (API de Anthropic): muestra el emisor OIDC de Nexo, la audiencia y el sujeto del
 *   workspace para registrarlos en la Consola de Claude, y pide los ids de la regla y la cuenta de servicio.
 * - «Rol de IAM de AWS» (Amazon Bedrock, Claude Platform on AWS): genera un ExternalId único y muestra las políticas
 *   de confianza y de permisos para crear el rol; pide el ARN del rol.
 * En ambos casos Nexo prueba la conexión antes de guardarla y no almacena ningún secreto.
 */
@Component({
  selector: 'nx-keyless-connect',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = provider();
    @let m = mechanism();
    @let s = setup();
    <form class="kl" (ngSubmit)="submit()" novalidate>
      @if (steps().length) {
        <div class="steps">
          <strong id="kl-steps">{{ isAws() ? 'Cómo crear el rol en su cuenta de AWS' : 'Cómo registrar a Nexo en la Consola de Claude' }}</strong>
          <ol aria-labelledby="kl-steps">@for (st of steps(); track $index) { <li>{{ st }}</li> }</ol>
        </div>
      }

      @if (!m.available) {
        <p class="unavail"><nx-icon name="lock" [size]="14" />{{ m.unavailableReason || 'No disponible en esta instalación.' }}</p>
      } @else if (wif(); as w) {
        <section class="setup" aria-labelledby="kl-wif">
          <h3 id="kl-wif" class="small">Datos del emisor de Nexo</h3>
          <dl>
            @for (row of wifRows(); track row.key) {
              <div class="row">
                <dt>{{ row.label }}</dt>
                <dd><code>{{ row.value }}</code>
                  <button type="button" class="btn ghost icon sm" [attr.aria-label]="'Copiar ' + row.label" [title]="copied() === row.key ? 'Copiado' : 'Copiar'" (click)="copy(row.key, row.value)">
                    <nx-icon [name]="copied() === row.key ? 'check' : 'copy'" [size]="15" /></button></dd>
              </div>
            }
          </dl>
          @if (consoleUrl(); as c) {
            <a class="btn pill" [href]="c" target="_blank" rel="noopener noreferrer"><nx-icon name="externalLink" [size]="15" />Abrir Workload identity en la Consola de Claude<span class="sr-only"> (abre en otra pestaña)</span></a>
          }
          @if (w.ephemeralKey) {
            <div class="callout warning"><nx-icon name="alert" [size]="16" />
              <span>Esta instalación usa una clave de firma temporal (desarrollo): la federación deja de funcionar al reiniciar la API.</span></div>
          }
        </section>
      } @else if (aws(); as a) {
        <section class="setup" aria-labelledby="kl-aws">
          <h3 id="kl-aws" class="small">Datos para la política de confianza del rol</h3>
          <dl>
            <div class="row">
              <dt>ExternalId de esta conexión</dt>
              <dd><code>{{ a.externalId }}</code>
                <button type="button" class="btn ghost icon sm" aria-label="Copiar ExternalId" [title]="copied() === 'xid' ? 'Copiado' : 'Copiar'" (click)="copy('xid', a.externalId)">
                  <nx-icon [name]="copied() === 'xid' ? 'check' : 'copy'" [size]="15" /></button></dd>
            </div>
            <div class="row">
              <dt>Principal de Nexo</dt>
              <dd><code>{{ a.principalArn }}</code>
                <button type="button" class="btn ghost icon sm" aria-label="Copiar principal de Nexo" [title]="copied() === 'arn' ? 'Copiado' : 'Copiar'" (click)="copy('arn', a.principalArn)">
                  <nx-icon [name]="copied() === 'arn' ? 'check' : 'copy'" [size]="15" /></button></dd>
            </div>
          </dl>
          @for (pol of policies(); track pol.key) {
            <div class="policy">
              <div class="policy-head"><strong>{{ pol.label }}</strong>
                <button type="button" class="btn ghost sm" (click)="copy(pol.key, pol.json)"><nx-icon [name]="copied() === pol.key ? 'check' : 'copy'" [size]="14" />{{ copied() === pol.key ? 'Copiada' : 'Copiar' }}</button></div>
              <pre tabindex="0" [attr.aria-label]="pol.label">{{ pol.json }}</pre>
            </div>
          }
          <p class="hint">Válido hasta {{ expires() }}. No reutilice este ExternalId en otra conexión.</p>
        </section>
      } @else if (isAws()) {
        <button type="button" class="btn primary pill wide" [disabled]="busy() === 'prepare'" (click)="prepare()">
          @if (busy() === 'prepare') { <span class="spin" aria-hidden="true"></span>Generando… } @else { <nx-icon name="key" [size]="16" />Generar ExternalId }
        </button>
      } @else if (busy() === 'prepare') {
        <p class="hint" role="status"><span class="spin dark" aria-hidden="true"></span> Preparando los datos del emisor…</p>
      }

      @if (m.available && s) {
        @for (f of fields(); track f.key) {
          @let ferr = fieldError(f);
          <div class="field">
            <label [for]="'kl-' + f.key">{{ f.label }}@if (!isRequired(f)) { <span class="opt"> (opcional)</span> }</label>
            <input class="input" [class.mono]="f.key !== 'region'" [class.invalid]="!!ferr" [id]="'kl-' + f.key" [name]="f.key" type="text" spellcheck="false" autocomplete="off"
              [placeholder]="f.placeholder || f.default || ''" [required]="isRequired(f)" [attr.aria-invalid]="!!ferr" [attr.aria-describedby]="'kl-' + f.key + '-help'"
              [ngModel]="values()[f.key] ?? ''" [ngModelOptions]="{ standalone: true }" (ngModelChange)="setValue(f.key, $event)" (blur)="touch(f.key)" />
            <span [id]="'kl-' + f.key + '-help'">
              @if (ferr) { <span class="error-text block">{{ ferr }}</span> }
              @if (f.help) { <span class="hint block">{{ f.help }}</span> }
            </span>
          </div>
        }
        @if (p.suggestedModels.length) {
          <details class="models">
            <summary>Modelos a habilitar ({{ selected().size }})<nx-icon name="chevronDown" [size]="16" /></summary>
            <ul class="model-list">
              @for (sm of p.suggestedModels; track sm.id) {
                <li><label class="choice">
                  <input type="checkbox" [checked]="selected().has(sm.id)" (change)="toggleModel(sm.id)" />
                  <span class="grow"><strong>{{ sm.label }}</strong> <span class="badge tier">{{ tierLabels[sm.tier] }}</span>
                    <span class="muted small block"><code>{{ sm.id }}</code></span></span>
                </label></li>
              }
            </ul>
            @if (!selected().size) { <p class="error-text">Elija al menos un modelo.</p> }
          </details>
        }
        <div class="field">
          <label for="kl-name">Nombre de la conexión <span class="opt">(opcional)</span></label>
          <input id="kl-name" name="connName" class="input" [placeholder]="p.name" [ngModel]="name()" (ngModelChange)="name.set($event)" />
        </div>
        @if (p.notes) { <p class="small muted">{{ p.notes }}</p> }
        <button type="submit" class="btn primary pill wide" [disabled]="!canSubmit()">
          @if (busy() === 'connect') { <span class="spin" aria-hidden="true"></span>Probando conexión… } @else { <nx-icon name="shield" [size]="16" />Conectar sin claves }
        </button>
      }
      @if (error(); as err) {
        <div class="callout danger" role="alert" tabindex="-1"><nx-icon name="alert" [size]="16" /><span>{{ err }}</span></div>
      }
      <span class="sr-only" role="status">{{ busy() === 'connect' ? 'Probando conexión' : '' }}</span>
    </form>
  `,
  styles: `
    .kl { display: flex; flex-direction: column; gap: 14px; }
    .steps { background: var(--surface-2); border-radius: 12px; padding: 14px 16px; font-size: 13.5px; }
    .steps ol { margin: 8px 0 0; padding-left: 20px; display: grid; gap: 4px; }
    .setup { display: grid; gap: 10px; border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; }
    .setup h3 { margin: 0; font-size: 12.5px; font-weight: 600; color: var(--muted); }
    dl { margin: 0; display: grid; gap: 8px; }
    .row { display: grid; gap: 2px; }
    dt { font-size: 12px; color: var(--muted); }
    dd { margin: 0; display: flex; align-items: center; gap: 6px; }
    dd code { overflow-wrap: anywhere; font-size: 12.5px; }
    .policy { display: grid; gap: 6px; }
    .policy-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; }
    pre { margin: 0; max-height: 220px; overflow: auto; background: var(--surface-2); border-radius: 10px; padding: 10px 12px; font-size: 12px; }
    pre:focus-visible { outline: 2px solid var(--primary); }
    .pill { border-radius: 999px; height: 40px; padding: 0 18px; }
    .wide { width: 100%; justify-content: center; }
    .unavail { margin: 0; display: flex; gap: 6px; align-items: flex-start; color: var(--muted); font-size: 12.5px; }
    .field label { font-size: 13px; color: var(--text); }
    .opt { color: var(--muted); font-weight: 500; }
    .block { display: block; }
    .hint { font-size: 12px; color: var(--muted); margin: 0; }
    .models { border: 1px solid var(--border); border-radius: 12px; }
    .models summary { list-style: none; cursor: pointer; padding: 12px 14px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; border-radius: 12px; }
    .models summary::-webkit-details-marker { display: none; }
    .models summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .models[open] summary nx-icon { transform: rotate(180deg); }
    .model-list { list-style: none; margin: 0; padding: 0 10px 10px; display: grid; gap: 6px; max-height: 240px; overflow-y: auto; }
    .model-list code { overflow-wrap: anywhere; }
    .models .error-text { margin: 0 14px 12px; }
    .tier { height: 18px; font-size: 10.5px; padding: 0 7px; margin-left: 4px; }
    .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.4); border-top-color: #fff; animation: spin 0.7s linear infinite; display: inline-block; }
    .spin.dark { border-color: var(--border); border-top-color: var(--info); }
    @keyframes spin { to { transform: rotate(360deg); } }
  `,
})
export class KeylessConnectComponent implements OnInit {
  private readonly api = inject(LlmProvidersApi);

  readonly provider = input.required<ProviderView>();
  readonly mechanism = input.required<ProviderMechanism>();
  /** Conexión creada y probada: la página recarga la galería. */
  readonly connected = output<ProviderConnectResult>();

  readonly tierLabels = TIER_LABELS;
  readonly isRequired = isRequired;
  readonly setup = signal<KeylessSetup | null>(null);
  readonly busy = signal<'prepare' | 'connect' | null>(null);
  readonly error = signal<string | null>(null);
  readonly values = signal<Partial<Record<string, string>>>({});
  readonly touched = signal<ReadonlySet<string>>(new Set());
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly name = signal('');
  readonly copied = signal<string | null>(null);

  readonly type = computed(() => this.mechanism().type as KeylessMechanism);
  /** Datos de la federación de identidad, si ya se prepararon. */
  readonly wif = computed(() => {
    const s = this.setup();
    return s?.mechanism === 'WORKLOAD_IDENTITY' ? s : null;
  });
  /** ExternalId y políticas del rol de IAM, si ya se generaron. */
  readonly aws = computed(() => {
    const s = this.setup();
    return s?.mechanism === 'AWS_ROLE' ? s : null;
  });
  readonly isAws = computed(() => this.type() === 'AWS_ROLE');
  readonly fields = computed(() => fieldsFor(this.provider(), this.type()).filter((f) => !f.secret));
  readonly steps = computed(() => {
    const s = this.setup()?.steps ?? this.mechanism().steps ?? [];
    return s.filter((x) => !!x?.trim());
  });
  readonly consoleUrl = computed(() => {
    const s = this.setup();
    return s?.mechanism === 'WORKLOAD_IDENTITY' && isHttpUrl(s.consoleUrl) ? s.consoleUrl : null;
  });
  readonly wifRows = computed(() => {
    const s = this.setup();
    if (s?.mechanism !== 'WORKLOAD_IDENTITY') return [];
    return [
      { key: 'issuer', label: 'URL del emisor (issuer)', value: s.issuerUrl },
      { key: 'aud', label: 'Audiencia (audience)', value: s.audience },
      { key: 'sub', label: 'Sujeto exacto (subject_prefix, sin «*»)', value: s.subject },
      { key: 'scope', label: 'Alcance sugerido (oauth_scope)', value: s.suggestedScope },
      { key: 'jwks', label: 'JWKS (para verificar)', value: s.jwksUrl },
    ];
  });
  readonly policies = computed(() => {
    const s = this.setup();
    if (s?.mechanism !== 'AWS_ROLE') return [];
    return [
      { key: 'trust', label: 'Política de confianza', json: JSON.stringify(s.trustPolicy, null, 2) },
      { key: 'perms', label: 'Política de permisos sugerida', json: JSON.stringify(s.permissionsPolicy, null, 2) },
    ];
  });
  readonly expires = computed(() => {
    const s = this.setup();
    return s?.mechanism === 'AWS_ROLE' ? new Date(s.expiresAt).toLocaleString('es') : '';
  });

  readonly canSubmit = computed(() => {
    if (this.busy() || !this.setup() || !this.mechanism().available) return false;
    for (const f of this.fields()) {
      const v = (this.values()[f.key] ?? '').trim();
      if (isRequired(f) && !v) return false;
      if (v && !this.patternOk(f, v)) return false;
    }
    return !this.provider().suggestedModels?.length || this.selected().size > 0;
  });

  ngOnInit() {
    this.selected.set(new Set((this.provider().suggestedModels ?? []).map((m) => m.id)));
    // La federación no genera nada nuevo: se muestran sus datos al abrir. El ExternalId se genera a pedido.
    if (this.mechanism().available && !this.isAws()) void this.prepare();
  }

  async prepare() {
    this.busy.set('prepare');
    this.error.set(null);
    try {
      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries(this.values())) if (v?.trim()) fields[k] = v.trim();
      this.setup.set(await this.api.prepareKeyless(this.provider().id, this.type(), fields));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  async copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(key);
      setTimeout(() => this.copied.set(this.copied() === key ? null : this.copied()), 2000);
    } catch {
      this.error.set('No se pudo copiar al portapapeles: seleccione el texto y cópielo manualmente.');
    }
  }

  setValue(key: string, value: string) {
    this.values.update((v) => ({ ...v, [key]: value }));
    if (this.error()) this.error.set(null);
  }

  touch(key: string) {
    this.touched.update((s) => new Set(s).add(key));
  }

  toggleModel(id: string) {
    this.selected.update((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  }

  patternOk(f: ProviderField, value: string) {
    if (!f.pattern) return true;
    try {
      return new RegExp(f.pattern).test(value);
    } catch {
      return true;
    }
  }

  fieldError(f: ProviderField): string | null {
    if (!this.touched().has(f.key)) return null;
    const v = (this.values()[f.key] ?? '').trim();
    if (isRequired(f) && !v) return `${f.label} es obligatorio.`;
    if (v && !this.patternOk(f, v)) return `El formato de ${f.label.toLowerCase()} no es válido.`;
    return null;
  }

  async submit() {
    if (!this.canSubmit()) {
      this.touched.set(new Set(this.fields().map((f) => f.key)));
      return;
    }
    const p = this.provider();
    const s = this.setup();
    const fields: Record<string, string> = {};
    for (const f of this.fields()) {
      const v = this.values()[f.key]?.trim();
      if (v) fields[f.key] = v;
    }
    this.busy.set('connect');
    this.error.set(null);
    try {
      const res = await this.api.connect(p.id, {
        ...(this.name().trim() ? { name: this.name().trim() } : {}),
        fields,
        mechanism: this.type(),
        ...(s?.mechanism === 'AWS_ROLE' ? { setupToken: s.setupToken } : {}),
        ...(p.suggestedModels?.length ? { models: [...this.selected()] } : {}),
      });
      this.connected.emit(res);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }
}
