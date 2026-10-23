import { ChangeDetectionStrategy, Component, computed, DOCUMENT, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { LlmProvidersApi } from '../../core/llm-providers.api';
import type { ProviderCategory, ProviderView } from '../../core/llm-providers.models';
import type { LlmConnection, LlmModel, ProviderInfo } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import type { BrandLogo } from '../integrations/integration-logos';
import { BrandLogoComponent } from '../integrations/brand-logo.component';
import { providerLogo } from './ai-provider-logos';
import { LlmModelsComponent } from './llm-models.component';
import { ProviderConnectComponent } from './provider-connect.component';
import {
  BILLING_LABELS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  CONNECTION_FILTERS,
  type ConnectionFilter,
  llmOAuthError,
  matchesFilter,
  normalize,
} from './provider-meta';

type Tab = 'providers' | 'models';

interface Row {
  p: ProviderView;
  logo: BrandLogo;
  /** Modelo que coincidió con la búsqueda cuando no coincide el nombre ni la descripción. */
  matchedModel: string | null;
}

/** Tarjeta de «Conectados»: conexión de un proveedor, conexión incluida por Nexo o conexión heredada sin proveedor. */
interface ConnectedCard {
  key: string;
  title: string;
  subtitle: string;
  connectionName: string | null;
  logo: BrandLogo;
  entry: { id: string; name: string };
  status: 'on' | 'off' | 'missing';
  statusLabel: string;
  provider: ProviderView | null;
  connectionId: string | null;
  enabled: boolean;
  platform: boolean;
  /** Valor del filtro de proveedor en «Modelos de IA» para «Ver modelos». */
  modelsKey: string;
}

/** Galería de proveedores de IA del workspace (solo ADMIN+, ruta bajo `adminGuard`). */
@Component({
  selector: 'nx-admin-providers',
  imports: [FormsModule, IconComponent, BrandLogoComponent, ProviderConnectComponent, LlmModelsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './providers.page.html',
  styleUrl: './providers.page.scss',
  host: { '(document:click)': 'onDocumentClick($event)' },
})
export class ProvidersPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly llm = inject(LlmProvidersApi);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  readonly filters = CONNECTION_FILTERS;
  readonly billingLabels = BILLING_LABELS;
  readonly categoryLabels = CATEGORY_LABELS;

  readonly tab = signal<Tab>('providers');
  readonly providers = signal<ProviderView[]>([]);
  readonly connections = signal<LlmConnection[]>([]);
  readonly catalog = signal<ProviderInfo[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly modelsError = signal<string | null>(null);

  readonly query = signal('');
  readonly filter = signal<ConnectionFilter | ''>('');
  readonly grouped = signal(true);
  readonly modelsProvider = signal('');
  readonly connecting = signal<ProviderView | null>(null);
  readonly menu = signal<string | null>(null);
  readonly testing = signal<string | null>(null);
  private trigger: HTMLElement | null = null;

  readonly filtering = computed(() => !!this.query().trim() || !!this.filter());

  readonly filterCounts = computed(() => {
    const counts: Record<string, number> = {};
    for (const f of this.filters) counts[f.id] = this.providers().filter((p) => matchesFilter(p, f.id)).length;
    return counts;
  });

  /** Proveedores que pasan búsqueda y filtro (conectados o no). */
  private readonly matching = computed<Row[]>(() => {
    const q = normalize(this.query().trim());
    const f = this.filter();
    const out: Row[] = [];
    for (const p of this.providers()) {
      if (f && !matchesFilter(p, f)) continue;
      const logo = providerLogo(p);
      if (!q) {
        out.push({ p, logo, matchedModel: null });
        continue;
      }
      const head = normalize(`${p.name} ${p.id} ${p.description} ${CATEGORY_LABELS[p.category] ?? ''}`).includes(q);
      const m = head ? null : (p.suggestedModels ?? []).find((s) => normalize(`${s.label} ${s.id}`).includes(q));
      if (head || m) out.push({ p, logo, matchedModel: m?.label ?? null });
    }
    return out;
  });

  readonly available = computed(() => this.matching().filter((r) => !r.p.connected?.length));

  readonly sections = computed(() => {
    const rows = this.available();
    if (!this.grouped()) return [{ id: 'all', title: '', rows }];
    const known = new Set<string>(CATEGORY_ORDER);
    const groups: { id: string; title: string; rows: Row[] }[] = CATEGORY_ORDER.map((c: ProviderCategory) => ({
      id: c,
      title: CATEGORY_LABELS[c],
      rows: rows.filter((r) => r.p.category === c),
    }));
    groups.push({ id: 'other', title: 'Otros', rows: rows.filter((r) => !known.has(r.p.category)) });
    return groups.filter((g) => g.rows.length);
  });

  readonly connected = computed<ConnectedCard[]>(() => {
    const q = this.filtering();
    const matchIds = new Set(this.matching().map((r) => r.p.id));
    const conns = new Map(this.connections().map((c) => [c.id, c]));
    const out: ConnectedCard[] = [];
    const anthropic = this.providers().find((p) => p.id === 'anthropic') ?? null;
    const system = this.catalog().find((c) => c.system && c.kind === 'ANTHROPIC');
    const platformConfigured = anthropic?.platform?.configured ?? system?.configured;
    if (platformConfigured !== undefined && (!q || matchIds.has('anthropic'))) {
      const n = system?.models.length ?? 0;
      out.push({
        key: 'platform',
        title: 'Anthropic',
        subtitle: platformConfigured ? `Incluido por Nexo · ${n} ${n === 1 ? 'modelo' : 'modelos'}` : 'Incluido por Nexo · No configurada en el servidor',
        connectionName: null,
        logo: providerLogo(anthropic ?? { id: 'anthropic', name: 'Anthropic' }),
        entry: { id: 'anthropic', name: 'Anthropic' },
        status: platformConfigured ? 'on' : 'missing',
        statusLabel: platformConfigured ? 'Activa' : 'No configurada',
        provider: anthropic,
        connectionId: null,
        enabled: !!platformConfigured,
        platform: true,
        modelsKey: 'anthropic',
      });
    }
    const mapped = new Set<string>();
    for (const r of this.matching()) {
      for (const c of r.p.connected ?? []) {
        mapped.add(c.connectionId);
        const n = conns.get(c.connectionId)?.models.length ?? c.modelCount;
        out.push(this.card(r.p, r.logo, c.connectionId, c.name, n, c.enabled));
      }
    }
    for (const p of this.providers()) for (const c of p.connected ?? []) mapped.add(c.connectionId);
    if (!q) {
      // Conexiones creadas antes de la galería (o de un proveedor que ya no está en el catálogo); el simulado solo en Modelos.
      for (const c of this.connections()) {
        if (mapped.has(c.id) || c.kind === 'MOCK') continue;
        const entry = c.kind === 'ANTHROPIC' ? { id: 'anthropic', name: 'Anthropic' } : { id: `conn-${c.id}`, name: c.name };
        out.push({
          ...this.card(null, providerLogo(entry), c.id, c.name, c.models.length, c.enabled),
          title: c.name,
          entry,
          subtitle: `${c.models.length} ${c.models.length === 1 ? 'modelo' : 'modelos'} · ${c.kind === 'ANTHROPIC' ? 'Anthropic' : 'Compatible con OpenAI'}`,
          connectionName: null,
          modelsKey: c.kind === 'ANTHROPIC' && anthropic ? 'anthropic' : `conn:${c.id}`,
        });
      }
    }
    return out;
  });

  readonly totalAvailable = computed(() => this.providers().filter((p) => !p.connected?.length).length);

  async ngOnInit() {
    const qp = this.route.snapshot.queryParamMap;
    if (qp.get('tab') === 'models') this.tab.set('models');
    const llm = qp.get('llm');
    if (llm === 'connected') this.toast.success('OpenRouter quedó conectado. Revise sus modelos y tarifas en «Modelos de IA».');
    else if (llm === 'error') this.toast.error(llmOAuthError(qp.get('reason')));
    if (llm) void this.router.navigate([], { queryParams: { llm: null, reason: null }, queryParamsHandling: 'merge', replaceUrl: true });
    await this.load();
  }

  async load(silent = false) {
    if (!silent) this.loading.set(true);
    this.error.set(null);
    this.modelsError.set(null);
    const [providers, connections, catalog] = await Promise.allSettled([
      this.llm.providers(),
      this.api.llmConnections(),
      this.api.llmCatalog(),
    ]);
    if (providers.status === 'fulfilled') this.providers.set(providers.value?.providers ?? []);
    else this.error.set(errorMessage(providers.reason));
    if (connections.status === 'fulfilled') this.connections.set(connections.value);
    else this.modelsError.set(errorMessage(connections.reason));
    if (catalog.status === 'fulfilled') this.catalog.set(catalog.value);
    this.loading.set(false);
  }

  selectTab(t: Tab, focus = false) {
    this.tab.set(t);
    this.menu.set(null);
    void this.router.navigate([], { queryParams: { tab: t === 'models' ? 'models' : null }, queryParamsHandling: 'merge', replaceUrl: true });
    if (focus) setTimeout(() => this.document.getElementById(`tab-${t}`)?.focus());
  }

  onTabKey(ev: KeyboardEvent) {
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft' || ev.key === 'Home' || ev.key === 'End') {
      ev.preventDefault();
      this.selectTab(this.tab() === 'providers' ? 'models' : 'providers', true);
    }
  }

  setFilter(f: ConnectionFilter | '') {
    this.filter.set(this.filter() === f ? '' : f);
  }

  clearFilters() {
    this.query.set('');
    this.filter.set('');
  }

  openConnect(p: ProviderView, ev: Event) {
    this.trigger = (ev.currentTarget as HTMLElement) ?? null;
    this.menu.set(null);
    this.connecting.set(p);
  }

  connectClosed() {
    this.connecting.set(null);
    const t = this.trigger;
    if (t?.isConnected) setTimeout(() => t.focus());
  }

  async onConnected(p: ProviderView) {
    this.toast.success(`${p.name} quedó conectado`);
    this.trigger = null;
    await this.load(true);
  }

  goModels(providerId: string | null) {
    this.connecting.set(null);
    this.modelsProvider.set(providerId ?? '');
    this.selectTab('models', true);
  }

  onModelUpdated(m: LlmModel) {
    this.connections.update((list) =>
      list.map((c) => (c.id === m.connectionId ? { ...c, models: c.models.map((x) => (x.id === m.id ? m : x)) } : c)),
    );
  }

  // ----- Menú «Gestionar» -----

  toggleMenu(key: string, ev: Event) {
    ev.stopPropagation();
    const open = this.menu() === key ? null : key;
    this.menu.set(open);
    if (open) setTimeout(() => this.menuItems(key)[0]?.focus());
  }

  onMenuKey(key: string, ev: KeyboardEvent) {
    const items = this.menuItems(key);
    const i = items.indexOf(this.document.activeElement as HTMLElement);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      this.closeMenu(key);
    } else if (ev.key === 'Tab') {
      this.menu.set(null);
    }
  }

  closeMenu(key: string) {
    this.menu.set(null);
    setTimeout(() => this.document.getElementById(`menu-btn-${key}`)?.focus());
  }

  onDocumentClick(ev: MouseEvent) {
    if (this.menu() && !(ev.target as HTMLElement)?.closest?.('.menu-wrap')) this.menu.set(null);
  }

  private menuItems(key: string) {
    return Array.from(this.document.querySelectorAll<HTMLElement>(`#menu-${key} [role="menuitem"]`));
  }

  async test(card: ConnectedCard) {
    this.menu.set(null);
    if (!card.connectionId) return;
    this.testing.set(card.key);
    try {
      const r = await this.api.testLlmConnection(card.connectionId);
      if (r.ok) this.toast.success(`${card.title}: ${r.message || 'conexión correcta'}`);
      else this.toast.error(`${card.title}: ${r.message}`);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.testing.set(null);
    }
  }

  async toggleEnabled(card: ConnectedCard) {
    this.menu.set(null);
    if (!card.connectionId) return;
    try {
      await this.api.updateLlmConnection(card.connectionId, { enabled: !card.enabled });
      this.toast.success(card.enabled ? 'Conexión deshabilitada' : 'Conexión habilitada');
      await this.load(true);
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async disconnect(card: ConnectedCard) {
    this.menu.set(null);
    if (!card.connectionId) return;
    const name = card.connectionName ?? card.title;
    if (!confirm(`¿Desconectar «${name}»? Se eliminan la conexión y sus modelos. No se puede si hay agentes usándola.`)) return;
    try {
      await this.api.deleteLlmConnection(card.connectionId);
      this.toast.success(`${name} se desconectó`);
      await this.load(true);
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  modelCount(p: ProviderView) {
    const n = p.modelCount || p.suggestedModels?.length || 0;
    if (!n) return p.category === 'LOCAL' ? 'Los modelos de su servidor' : 'Modelos por descubrir';
    return `${n} ${n === 1 ? 'modelo' : 'modelos'}`;
  }

  private card(p: ProviderView | null, logo: BrandLogo, id: string, name: string, n: number, enabled: boolean): ConnectedCard {
    const title = p?.name ?? name;
    return {
      key: id,
      title,
      subtitle: `${n} ${n === 1 ? 'modelo' : 'modelos'} · ${p ? BILLING_LABELS[p.billing] : 'Conexión propia'}`,
      connectionName: name && name !== title ? name : null,
      logo,
      entry: { id: p?.id ?? id, name: title },
      status: enabled ? 'on' : 'off',
      statusLabel: enabled ? 'Activa' : 'Deshabilitada',
      provider: p,
      connectionId: id,
      enabled,
      platform: false,
      modelsKey: p?.id ?? `conn:${id}`,
    };
  }
}
