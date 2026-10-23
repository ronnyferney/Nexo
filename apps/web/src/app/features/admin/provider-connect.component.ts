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
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.service';
import { LlmProvidersApi } from '../../core/llm-providers.api';
import type { ProviderConnectResult, ProviderField, ProviderView, SuggestedModel } from '../../core/llm-providers.models';
import { TIER_LABELS } from '../../shared/budget';
import { IconComponent } from '../../shared/icon.component';
import { isHttpUrl } from '../../shared/safe-url';
import { formatUsd } from '../../shared/usd.pipe';
import { BrandLogoComponent } from '../integrations/brand-logo.component';
import { providerLogo } from './ai-provider-logos';
import { BILLING_LABELS, PERSONAL_PLANS } from './provider-meta';

/** Diálogo modal «Conectar <Proveedor>»: formulario dinámico desde `fields`, prueba la conexión y la guarda. */
@Component({
  selector: 'nx-provider-connect',
  imports: [FormsModule, IconComponent, BrandLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './provider-connect.component.html',
  styleUrl: './provider-connect.component.scss',
})
export class ProviderConnectComponent implements OnInit {
  private readonly api = inject(LlmProvidersApi);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  readonly provider = input.required<ProviderView>();
  readonly closed = output<void>();
  /** Conexión creada: la página recarga la galería (la fila pasa a «Conectados»). */
  readonly connected = output<ProviderConnectResult>();
  /** El usuario quiere revisar tarifas en la pestaña «Modelos de IA». */
  readonly goModels = output<void>();

  readonly tierLabels = TIER_LABELS;
  readonly billingLabels = BILLING_LABELS;
  readonly logo = computed(() => providerLogo(this.provider()));
  readonly personalPlan = computed(() => PERSONAL_PLANS[this.provider().id] ?? null);
  readonly keyUrl = computed(() => (isHttpUrl(this.provider().keyUrl) ? this.provider().keyUrl! : null));
  readonly docsUrl = computed(() => (isHttpUrl(this.provider().docsUrl) ? this.provider().docsUrl : null));
  readonly steps = computed(() => (this.provider().keySteps ?? []).filter((s) => !!s?.trim()));
  /** Campos extra (recurso, región, URL) arriba; la clave al final, como en la referencia. */
  readonly fields = computed(() => {
    const f = this.provider().fields ?? [];
    return [...f.filter((x) => !x.secret), ...f.filter((x) => x.secret)];
  });
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
  readonly busy = signal<'connect' | 'oauth' | null>(null);
  readonly error = signal<string | null>(null);
  readonly result = signal<ProviderConnectResult | null>(null);

  readonly canSubmit = computed(() => {
    if (this.busy()) return false;
    const v = this.values();
    for (const f of this.fields()) {
      const val = (v[f.key] ?? '').trim();
      if (f.required && !val) return false;
      if (val && !this.patternOk(f, val)) return false;
    }
    return !this.provider().suggestedModels?.length || this.selected().size > 0;
  });

  constructor() {
    afterNextRender(() => {
      const dlg = this.dialog().nativeElement;
      dlg.showModal();
      dlg.querySelector<HTMLElement>('.modal-body input')?.focus();
    });
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
    if (f.required && !val) return `${f.label} es obligatorio.`;
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
    if (!tokens) return null;
    return tokens >= 1_000_000 ? `${+(tokens / 1_000_000).toFixed(1)} M de contexto` : `${Math.round(tokens / 1000)} K de contexto`;
  }

  async submit() {
    if (!this.canSubmit()) {
      this.touched.set(new Set(this.fields().map((f) => f.key)));
      return;
    }
    const p = this.provider();
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.values())) if (v?.trim()) fields[k] = v.trim();
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

  async startOAuth() {
    this.busy.set('oauth');
    this.error.set(null);
    try {
      const { authorizeUrl } = await this.api.oauthStart(this.provider().id);
      if (!isHttpUrl(authorizeUrl)) throw new Error('El proveedor devolvió una dirección de autorización no válida.');
      window.location.assign(authorizeUrl);
    } catch (e) {
      this.error.set(errorMessage(e));
      this.busy.set(null);
    }
  }
}
