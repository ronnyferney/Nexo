import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.service';
import { LlmProvidersApi } from '../../core/llm-providers.api';
import type {
  DevicePollResult,
  MechanismType,
  ProviderConnectResult,
  ProviderField,
  ProviderMechanism,
  ProviderView,
  SuggestedModel,
} from '../../core/llm-providers.models';
import { TIER_LABELS } from '../../shared/budget';
import { IconComponent } from '../../shared/icon.component';
import { isHttpUrl } from '../../shared/safe-url';
import { formatUsd } from '../../shared/usd.pipe';
import { BrandLogoComponent } from '../integrations/brand-logo.component';
import { providerLogo } from './ai-provider-logos';
import { DeviceCodeComponent } from './device-code.component';
import { LlmOAuthFlow } from './llm-oauth.flow';
import { LocalDetectComponent } from './local-detect.component';
import {
  BILLING_LABELS,
  brandOf,
  fieldsFor,
  formatContext,
  isRequired,
  mechanismsOf,
  oauthFields,
  PERSONAL_PLANS,
} from './provider-meta';

/**
 * Diálogo modal «Conectar <Proveedor>». Muestra el mecanismo principal en grande (inicio de sesión OAuth, código de
 * dispositivo, detección local o clave de API) y los demás como alternativa; los no disponibles quedan deshabilitados
 * con su motivo.
 */
@Component({
  selector: 'nx-provider-connect',
  imports: [FormsModule, NgTemplateOutlet, IconComponent, BrandLogoComponent, DeviceCodeComponent, LocalDetectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './provider-connect.component.html',
  styleUrl: './provider-connect.component.scss',
})
export class ProviderConnectComponent implements OnInit {
  private readonly api = inject(LlmProvidersApi);
  readonly oauth = inject(LlmOAuthFlow);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  readonly provider = input.required<ProviderView>();
  /** Inicia el mecanismo principal al abrir (código de dispositivo o detección local tras pulsar «+»). */
  readonly autostart = input(false);
  /** Error del retorno OAuth para este proveedor (lo fija la página). */
  readonly oauthError = input<string | null>(null);
  readonly closed = output<void>();
  /** Conexión creada con clave o servidor local: la página recarga la galería (la fila pasa a «Conectados»). */
  readonly connected = output<ProviderConnectResult>();
  /** Sesión iniciada con código de dispositivo: la página cierra el diálogo y muestra el aviso. */
  readonly signedIn = output<DevicePollResult>();
  /** El usuario quiere revisar tarifas en la pestaña «Modelos de IA». */
  readonly goModels = output<void>();

  readonly tierLabels = TIER_LABELS;
  readonly billingLabels = BILLING_LABELS;
  readonly logo = computed(() => providerLogo(this.provider()));
  readonly personalPlan = computed(() => PERSONAL_PLANS[this.provider().id] ?? null);
  readonly keyUrl = computed(() => (isHttpUrl(this.provider().keyUrl) ? this.provider().keyUrl! : null));
  readonly docsUrl = computed(() => (isHttpUrl(this.provider().docsUrl) ? this.provider().docsUrl : null));
  readonly steps = computed(() => (this.provider().keySteps ?? []).filter((s) => !!s?.trim()));
  readonly mechanisms = computed(() => mechanismsOf(this.provider()));
  /** «Google» para Vertex AI («Iniciar sesión con Google»). */
  readonly brand = computed(() => brandOf(this.mode(), this.provider()));
  readonly modeType = signal<MechanismType | null>(null);
  /** Mecanismo visible: el elegido por el usuario o el principal. */
  readonly mode = computed<ProviderMechanism>(
    () => this.mechanisms().find((m) => m.type === this.modeType()) ?? this.mechanisms()[0],
  );
  readonly others = computed(() => this.mechanisms().filter((m) => m.type !== this.mode().type));
  readonly preFields = computed(() => (this.mode().type === 'OAUTH' ? oauthFields(this.provider(), this.mode()) : []));
  readonly waiting = computed(() => this.oauth.pending()?.providerId === this.provider().id);
  readonly oauthReady = computed(() =>
    this.preFields().every((f) => {
      const v = (this.values()[f.key] ?? '').trim();
      return (!isRequired(f) || !!v) && (!v || this.patternOk(f, v));
    }),
  );
  /** Campos extra (recurso, región, URL) arriba; la clave al final, como en la referencia. */
  readonly fields = computed(() => {
    const f = fieldsFor(this.provider(), 'API_KEY');
    return [...f.filter((x) => !x.secret), ...f.filter((x) => x.secret)];
  });
  readonly isRequired = isRequired;
  /** Campo al que aplica `keyPrefix`: `apiKey` o el primer secreto. */
  readonly keyField = computed(() => {
    const f = this.provider().fields ?? [];
    return (f.find((x) => x.key === 'apiKey') ?? f.find((x) => x.secret))?.key ?? null;
  });

  readonly values = signal<Partial<Record<string, string>>>({});
  readonly touched = signal<ReadonlySet<string>>(new Set());
  readonly revealed = signal<ReadonlySet<string>>(new Set());
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly name = signal('');
  readonly busy = signal<'connect' | null>(null);
  readonly error = signal<string | null>(null);
  readonly result = signal<ProviderConnectResult | null>(null);

  readonly canSubmit = computed(() => {
    if (this.busy()) return false;
    const v = this.values();
    for (const f of this.fields()) {
      const val = (v[f.key] ?? '').trim();
      if (isRequired(f) && !val) return false;
      if (val && !this.patternOk(f, val)) return false;
    }
    return !this.provider().suggestedModels?.length || this.selected().size > 0;
  });

  constructor() {
    afterNextRender(() => {
      const dlg = this.dialog().nativeElement;
      dlg.showModal();
      dlg.querySelector<HTMLElement>('.panel input, .panel .btn.primary, .modal-body input')?.focus();
    });
  }

  setMode(m: ProviderMechanism) {
    if (!m.available) return;
    this.modeType.set(m.type);
    this.error.set(null);
    setTimeout(() => this.dialog().nativeElement.querySelector<HTMLElement>('.panel input, .panel .btn.primary')?.focus());
  }

  /** Texto del botón alternativo («o usar una clave de API»). */
  altLabel(m: ProviderMechanism) {
    switch (m.type) {
      case 'API_KEY': {
        if (this.provider().category === 'LOCAL' || this.provider().auth === 'NONE') return 'Configurar la dirección manualmente';
        const l = m.label?.trim();
        return !l || /^clave de api$/i.test(l) ? 'Usar una clave de API' : `Usar ${l.charAt(0).toLowerCase()}${l.slice(1)}`;
      }
      case 'LOCAL_DETECT':
        return m.label || 'Detectar el servidor automáticamente';
      default:
        return m.label;
    }
  }

  async startOAuth() {
    if (!this.mode().available || !this.oauthReady()) {
      this.touched.set(new Set(this.preFields().map((f) => f.key)));
      return;
    }
    const fields: Record<string, string> = {};
    for (const f of this.preFields()) {
      const v = (this.values()[f.key] ?? '').trim();
      if (v) fields[f.key] = v;
    }
    this.error.set(null);
    try {
      await this.oauth.start(this.provider(), fields);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  cancelOAuth() {
    this.oauth.cancel();
  }

  onLocalConnected(res: ProviderConnectResult) {
    this.result.set(res);
    this.connected.emit(res);
    setTimeout(() => this.dialog().nativeElement.querySelector<HTMLElement>('.done-primary')?.focus());
  }

  ngOnInit() {
    this.selected.set(new Set((this.provider().suggestedModels ?? []).map((m) => m.id)));
  }

  close() {
    this.dialog().nativeElement.close();
  }

  setValue(key: string, value: string) {
    this.values.update((v) => ({ ...v, [key]: value }));
    if (this.error()) this.error.set(null);
  }

  touch(key: string) {
    this.touched.update((s) => new Set(s).add(key));
  }

  toggleReveal(key: string) {
    this.revealed.update((s) => {
      const n = new Set(s);
      if (!n.delete(key)) n.add(key);
      return n;
    });
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
      return true; // patrón inválido del servidor: no bloquear
    }
  }

  fieldError(f: ProviderField): string | null {
    if (!this.touched().has(f.key)) return null;
    const val = (this.values()[f.key] ?? '').trim();
    if (isRequired(f) && !val) return `${f.label} es obligatorio.`;
    if (val && !this.patternOk(f, val)) return `El formato de ${f.label.toLowerCase()} no es válido.`;
    return null;
  }

  /** Advertencia suave (no bloquea) si la clave no empieza con el prefijo habitual. */
  prefixWarning(f: ProviderField): string | null {
    const prefix = this.provider().keyPrefix;
    const val = (this.values()[f.key] ?? '').trim();
    if (!prefix || f.key !== this.keyField() || !val || val.startsWith(prefix)) return null;
    return `Las claves de ${this.provider().name} suelen empezar con «${prefix}». Revise que copió la clave completa.`;
  }

  price(m: SuggestedModel) {
    if (m.inputUsdPerMTok == null || m.outputUsdPerMTok == null) return null;
    return `${formatUsd(m.inputUsdPerMTok)} / ${formatUsd(m.outputUsdPerMTok)} por MTok`;
  }

  context(tokens?: number) {
    const c = formatContext(tokens);
    return c ? `${c} de contexto` : null;
  }

  async submit() {
    if (!this.canSubmit()) {
      this.touched.set(new Set(this.fields().map((f) => f.key)));
      return;
    }
    const p = this.provider();
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
        ...(p.suggestedModels?.length ? { models: [...this.selected()] } : {}),
      });
      this.result.set(res);
      this.connected.emit(res);
      setTimeout(() => this.dialog().nativeElement.querySelector<HTMLElement>('.done-primary')?.focus());
    } catch (e) {
      this.error.set(errorMessage(e));
      setTimeout(() => this.dialog().nativeElement.querySelector<HTMLElement>('.conn-error')?.focus());
    } finally {
      this.busy.set(null);
    }
  }
}
