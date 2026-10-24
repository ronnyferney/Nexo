import { ChangeDetectionStrategy, Component, computed, DOCUMENT, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { LlmProvidersApi } from '../../core/llm-providers.api';
import type {
  DeleteConnectionResult,
  LlmConnectionMeta,
  LlmModelMeta,
  MechanismType,
  ProviderCategory,
  ProviderView,
} from '../../core/llm-providers.models';
import type { LlmConnection, LlmModel, ProviderInfo } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import type { BrandLogo } from '../integrations/integration-logos';
import { BrandLogoComponent } from '../integrations/brand-logo.component';
import { providerLogo, vendorOf } from './ai-provider-logos';
import { type DisconnectAction, DisconnectConfirmComponent } from './disconnect-confirm.component';
import { LlmModelsComponent } from './llm-models.component';
import { LlmOAuthFlow, type OAuthOutcome } from './llm-oauth.flow';
import { ProviderConnectComponent } from './provider-connect.component';
import { type DetailModel, ProviderDetailComponent, type ProviderDetailData } from './provider-detail.component';
import {
  BILLING_LABELS,
  brandOf,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  CONNECTION_FILTERS,
  type ConnectionFilter,
  llmOAuthError,
  matchesFilter,
  mechanismsOf,
  mechanismSubtitle,
  normalize,
  oauthFields,
  primaryMechanism,
  specialtiesOf,
} from './provider-meta';

type Tab = 'providers' | 'models';

interface Row {
  p: ProviderView;
  logo: BrandLogo;
  /** Modelo que coincidió con la búsqueda cuando no coincide el nombre ni la descripción. */
  matchedModel: string | null;
  /** Subtítulo según el mecanismo principal («Iniciar sesión con Google · Vertex AI», «Clave de API · Pago por uso»). */
  subtitle: string;
  /** El mecanismo principal es un inicio de sesión (OAuth o código de dispositivo). */
  login: boolean;
  /** Título del botón «+»: lo que hará al pulsarlo. */
  action: string;
}

interface Notice {
  id: number;
  text: string;
  /** `ok` lleva la marca de verificación (sesión iniciada, conectado); `info` no (sesión cerrada). */
  kind: 'ok' | 'info';
  entry: { id: string; name: string };
  logo: BrandLogo;
}

interface ConfirmTarget {
  name: string;
  entry: { id: string; name: string };
  connectionId: string;
  action: DisconnectAction;
  /** Elemento al que vuelve el foco si se cancela. */
  returnFocus: string | null;
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
  /** Conexión creada con inicio de sesión (OAuth o código de dispositivo). */
  signedIn: boolean;
  /** Sesión cerrada: la conexión se conserva (modelos y agentes) hasta volver a iniciar sesión. */
  signedOut: boolean;
  /** Mecanismo con que se volvería a iniciar sesión sobre la misma conexión (null si no aplica o no está disponible). */
  reauthMechanism: MechanismType | null;
}

/** Galería de proveedores de IA del workspace (solo ADMIN+, ruta bajo `adminGuard`). */
@Component({
  selector: 'nx-admin-providers',
  imports: [
    FormsModule,
    IconComponent,
    BrandLogoComponent,
    ProviderConnectComponent,
    ProviderDetailComponent,
    DisconnectConfirmComponent,
    LlmModelsComponent,
  ],
  providers: [LlmOAuthFlow],
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
  readonly oauth = inject(LlmOAuthFlow);

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
  /** «Volver a iniciar sesión» en curso: el diálogo de conexión renueva esta conexión en lugar de crear otra. */
  readonly reauthTarget = signal<{ connectionId: string; mechanism: MechanismType; name: string } | null>(null);
  /** El diálogo se abrió con «+»: inicia el mecanismo principal (código de dispositivo, detección local). */
  readonly autostart = signal(false);
  readonly oauthErrors = signal<Partial<Record<string, string>>>({});
  readonly detail = signal<ProviderDetailData | null>(null);
  readonly confirmTarget = signal<ConfirmTarget | null>(null);
  readonly disconnecting = signal(false);
  readonly notice = signal<Notice | null>(null);
  /** Esta pestaña es la ventana emergente que volvió del proveedor: solo avisa a la principal y se cierra. */
  readonly popupDone = signal<'connected' | 'error' | null>(null);
  private noticeSeq = 0;
  /** Conexiones por proveedor al iniciar sesión, para saber si la ventana cerrada sin aviso sí conectó. */
  private readonly before = new Map<string, number>();
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
      const m = primaryMechanism(p);
      const login = m.type === 'OAUTH' || m.type === 'DEVICE_CODE';
      const base = { p, logo, subtitle: mechanismSubtitle(p), login, action: m.available ? m.label : `Conectar ${p.name}` };
      if (!q) {
        out.push({ ...base, matchedModel: null });
        continue;
      }
      const head = normalize(`${p.name} ${p.id} ${p.description} ${CATEGORY_LABELS[p.category] ?? ''}`).includes(q);
      const sm = head ? null : (p.suggestedModels ?? []).find((s) => normalize(`${s.label} ${s.id}`).includes(q));
      if (head || sm) out.push({ ...base, matchedModel: sm?.label ?? null });
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
        signedIn: false,
        signedOut: false,
        reauthMechanism: null,
      });
    }
    const mapped = new Set<string>();
    for (const r of this.matching()) {
      for (const c of r.p.connected ?? []) {
        mapped.add(c.connectionId);
        const n = conns.get(c.connectionId)?.models.length ?? c.modelCount;
        const conn = conns.get(c.connectionId) as LlmConnectionMeta | undefined;
        const signedIn = this.isSignedIn(r.p, c.mechanism, conn?.credentialType);
        out.push({
          ...this.card(r.p, r.logo, c.connectionId, c.name, n, c.enabled, signedIn, !!conn?.signedOut),
          reauthMechanism: signedIn && conn?.credentialType === 'OAUTH' ? this.reauthMechanism(r.p, c.mechanism) : null,
        });
      }
    }
    for (const p of this.providers()) for (const c of p.connected ?? []) mapped.add(c.connectionId);
    if (!q) {
      // Conexiones creadas antes de la galería (o de un proveedor que ya no está en el catálogo); el simulado solo en Modelos.
      for (const c of this.connections()) {
        if (mapped.has(c.id) || c.kind === 'MOCK') continue;
        const entry = c.kind === 'ANTHROPIC' ? { id: 'anthropic', name: 'Anthropic' } : { id: `conn-${c.id}`, name: c.name };
        out.push({
          ...this.card(null, providerLogo(entry), c.id, c.name, c.models.length, c.enabled, false, false),
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

  constructor() {
    this.oauth.onOutcome((o) => void this.onOAuthOutcome(o));
  }

  async ngOnInit() {
    const qp = this.route.snapshot.queryParamMap;
    if (qp.get('tab') === 'models') this.tab.set('models');
    const llm = qp.get('llm');
    if (llm === 'connected' || llm === 'error') {
      const ret = { llm, provider: qp.get('provider'), connectionId: qp.get('connectionId'), reason: qp.get('reason') } as const;
      // Ventana emergente de vuelta del proveedor: avisa a la principal y se cierra sin cargar la galería.
      if (this.oauth.notifyOpener(ret)) {
        this.popupDone.set(llm);
        this.loading.set(false);
        return;
      }
      // Sin ventana emergente (el navegador la bloqueó): el retorno llega a esta pestaña.
      void this.router.navigate([], {
        queryParams: { llm: null, reason: null, provider: null, connectionId: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
      await this.load();
      await this.onOAuthOutcome({ status: llm, providerId: ret.provider, connectionId: ret.connectionId, reason: ret.reason }, false);
      return;
    }
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

  openConnect(p: ProviderView, ev: Event, autostart = false) {
    this.trigger = (ev.currentTarget as HTMLElement) ?? null;
    this.menu.set(null);
    this.oauthErrors.update(({ [p.id]: _, ...rest }) => rest);
    this.autostart.set(autostart);
    this.reauthTarget.set(null);
    this.connecting.set(p);
  }

  /**
   * Botón «+» de la fila: inicia directamente el mecanismo principal. OAuth sin datos previos abre la ventana del
   * proveedor (la fila muestra «Conectando…/Cancelar»); el resto abre el diálogo y arranca el código o la detección.
   */
  quickConnect(p: ProviderView, ev: Event) {
    const m = primaryMechanism(p);
    if (m.type === 'OAUTH' && m.available && !oauthFields(p, m).length) {
      this.menu.set(null);
      this.before.set(p.id, p.connected?.length ?? 0);
      this.oauth.start(p).catch((e) => this.toast.error(errorMessage(e)));
      setTimeout(() => this.document.getElementById(`cancel-${p.id}`)?.focus());
      return;
    }
    this.openConnect(p, ev, m.available && (m.type === 'DEVICE_CODE' || m.type === 'LOCAL_DETECT'));
  }

  cancelLogin(p: ProviderView) {
    this.oauth.cancel();
    setTimeout(() => this.document.getElementById(`act-${p.id}`)?.focus());
  }

  connectClosed() {
    this.connecting.set(null);
    this.reauthTarget.set(null);
    const t = this.trigger;
    if (t?.isConnected) setTimeout(() => t.focus());
  }

  async onConnected(p: ProviderView) {
    this.showNotice(`${p.name} quedó conectado`, p);
    this.trigger = null;
    await this.load(true);
  }

  /** Código de dispositivo autorizado: se cierra el diálogo y la fila pasa a «Conectados». */
  async onSignedIn(p: ProviderView) {
    this.trigger = null;
    this.connecting.set(null);
    this.reauthTarget.set(null);
    await this.load(true);
    this.showNotice(`Sesión iniciada en ${p.name}`, p);
    this.focusConnected(p.id);
  }

  private async onOAuthOutcome(o: OAuthOutcome, reload = true) {
    const find = () => this.providers().find((p) => p.id === o.providerId) ?? null;
    if (o.status === 'closed') {
      // Ventana cerrada sin aviso: puede que sí haya conectado (p. ej. si el proveedor cortó `window.opener`).
      const prev = this.before.get(o.providerId) ?? 0;
      await this.load(true);
      const p = find();
      if (p && (p.connected?.length ?? 0) > prev) await this.onOAuthOutcome({ ...o, status: 'connected' }, false);
      return;
    }
    if (o.status === 'connected') {
      if (reload) await this.load(true);
      const p = find();
      const name = p?.name ?? 'el proveedor';
      if (this.connecting()?.id === o.providerId || !o.providerId) {
        this.trigger = null;
        this.connecting.set(null);
        this.reauthTarget.set(null);
      }
      this.showNotice(`Sesión iniciada en ${name}`, p ?? { id: o.providerId ?? 'llm', name });
      if (p) this.focusConnected(p.id);
      return;
    }
    const p = find();
    const msg = llmOAuthError(o.reason, p?.name);
    if (p && this.connecting()?.id === p.id) this.oauthErrors.update((e) => ({ ...e, [p.id]: msg }));
    else this.toast.error(msg);
  }

  showNotice(text: string, p: { id: string; name: string; logo?: string | null }, kind: Notice['kind'] = 'ok') {
    const id = ++this.noticeSeq;
    this.notice.set({ id, text, kind, entry: { id: p.id, name: p.name }, logo: providerLogo(p) });
    setTimeout(() => this.notice()?.id === id && this.notice.set(null), 6000);
  }

  private focusConnected(providerId: string) {
    setTimeout(() => this.document.querySelector<HTMLElement>(`[data-provider="${CSS.escape(providerId)}"] .cc-main`)?.focus(), 50);
  }

  // ----- Diálogo del proveedor conectado -----

  openDetail(card: ConnectedCard, ev: Event) {
    this.trigger = (ev.currentTarget as HTMLElement) ?? null;
    this.menu.set(null);
    this.detail.set(this.detailData(card));
  }

  detailGoModels(d: ProviderDetailData) {
    this.goModels(this.connected().find((c) => c.key === d.key)?.modelsKey ?? null);
  }

  closeWindow() {
    this.document.defaultView?.close();
  }

  detailClosed() {
    if (this.confirmTarget()) return;
    this.detail.set(null);
    const t = this.trigger;
    if (t?.isConnected) setTimeout(() => t.focus());
  }

  private detailData(c: ConnectedCard): ProviderDetailData {
    const p = c.provider;
    const suggested = new Map((p?.suggestedModels ?? []).map((m) => [m.id, m]));
    let models: DetailModel[];
    if (c.platform) {
      const system = this.catalog().find((x) => x.system && x.kind === 'ANTHROPIC');
      models = (system?.models ?? []).map((m) => {
        const s = suggested.get(m.id);
        return {
          key: m.id,
          label: m.label,
          modelId: m.id,
          tier: m.tier,
          specialties: specialtiesOf(m.id, s?.specialties),
          contextTokens: s?.contextTokens ?? null,
          input: m.inputUsdPerMTok,
          output: m.outputUsdPerMTok,
          enabled: true,
        };
      });
    } else {
      const conn = this.connections().find((x) => x.id === c.connectionId);
      models = ((conn?.models ?? []) as LlmModelMeta[]).map((m) => {
        const s = suggested.get(m.modelId);
        return {
          key: m.id,
          label: m.label,
          modelId: m.modelId,
          tier: m.tier,
          specialties: specialtiesOf(m.modelId, m.specialties ?? s?.specialties),
          contextTokens: m.contextTokens ?? s?.contextTokens ?? null,
          input: m.inputUsdPerMTok ?? null,
          output: m.outputUsdPerMTok ?? null,
          enabled: m.enabled,
          needsPricing: m.needsPricing,
          local: p?.category === 'LOCAL',
          vendor: vendorOf(m.modelId),
        };
      });
    }
    const local = p?.category === 'LOCAL';
    const conn = this.connections().find((x) => x.id === c.connectionId) as LlmConnectionMeta | undefined;
    const brand = p ? brandOf(primaryMechanism(p), p) : c.title;
    return {
      key: c.key,
      title: c.title,
      entry: c.entry,
      logo: c.logo,
      status: c.status,
      statusLabel: c.signedOut ? 'Sesión cerrada' : c.status === 'on' ? 'Conectado' : c.status === 'off' ? 'Deshabilitado' : 'No configurado',
      footLabel: c.platform
        ? 'Incluido por Nexo: usa la cuenta de la plataforma, sin inicio de sesión'
        : c.signedOut
          ? `Sesión de ${brand} cerrada`
          : c.signedIn
            ? `Sesión iniciada con ${brand}`
            : local
              ? 'Conectado a su servidor local'
              : 'Conectado con clave de API',
      signedIn: c.signedIn,
      sessionNote: c.signedOut ? 'Sus modelos y agentes se conservan hasta que vuelva a iniciar sesión.' : this.sessionNote(conn),
      signedOut: c.signedOut,
      canReauth: !!c.reauthMechanism,
      canDisconnect: !!c.connectionId,
      models,
    };
  }

  /** Renovación del token OAuth de la conexión (solo `credentialType: 'OAUTH'`). */
  private sessionNote(conn?: LlmConnectionMeta): string | null {
    if (conn?.credentialType !== 'OAUTH') return null;
    if (conn.oauthRenewable) return 'La sesión se renueva automáticamente.';
    const exp = conn.oauthExpiresAt ? new Date(conn.oauthExpiresAt) : null;
    const when = exp && !Number.isNaN(exp.getTime()) ? ` (${exp.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })})` : '';
    return exp && exp.getTime() < Date.now()
      ? `La sesión expiró${when}: vuelva a iniciar sesión.`
      : `Vuelva a iniciar sesión cuando expire${when}.`;
  }

  /**
   * Conexión creada con inicio de sesión: por `mechanism` de la referencia o `credentialType` de la conexión;
   * si el servidor no informa ninguno, se asume solo cuando el proveedor no ofrece otra vía.
   */
  private isSignedIn(p: ProviderView, mechanism?: string, credential?: string) {
    if (mechanism) return mechanism === 'OAUTH' || mechanism === 'DEVICE_CODE';
    if (credential) return credential === 'OAUTH';
    const types = mechanismsOf(p).map((m) => m.type);
    return types.length > 0 && types.every((t) => t === 'OAUTH' || t === 'DEVICE_CODE');
  }

  /** Mecanismo de inicio de sesión disponible para renovar la conexión: el que la creó o, si falta, el principal. */
  private reauthMechanism(p: ProviderView, mechanism?: MechanismType): MechanismType | null {
    const usable = mechanismsOf(p).filter((m) => m.available && (m.type === 'OAUTH' || m.type === 'DEVICE_CODE'));
    return (usable.find((m) => m.type === mechanism) ?? usable[0])?.type ?? null;
  }

  goModels(providerId: string | null) {
    this.connecting.set(null);
    this.reauthTarget.set(null);
    this.detail.set(null);
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

  /**
   * Abre la confirmación «¿Cerrar sesión de…?» (conserva la conexión), «¿Eliminar la conexión…?» (conexión con inicio
   * de sesión) o «¿Desconectar…?» (clave de API), desde el menú de la tarjeta o el diálogo del proveedor.
   */
  disconnect(card: ConnectedCard, signOut = false, fromDetail = false) {
    this.menu.set(null);
    if (!card.connectionId) return;
    this.confirmTarget.set({
      name: card.connectionName && !fromDetail ? `${card.title} (${card.connectionName})` : card.title,
      entry: { id: card.provider?.id ?? card.entry.id, name: card.title },
      connectionId: card.connectionId,
      action: signOut ? 'signOut' : card.signedIn ? 'delete' : 'disconnect',
      returnFocus: fromDetail ? null : `menu-btn-${card.key}`,
    });
  }

  disconnectFromDetail(signOut = false) {
    const card = this.detailCard();
    if (card) this.disconnect(card, signOut, true);
  }

  /**
   * «Volver a iniciar sesión»: abre el diálogo de conexión del proveedor limitado al mecanismo de la conexión; el
   * servidor renueva los tokens de esa misma conexión (no crea otra), así que agentes y modelos siguen funcionando.
   */
  reauth(card: ConnectedCard, ev: Event | null) {
    this.menu.set(null);
    if (!card.connectionId || !card.provider || !card.reauthMechanism) return;
    if (ev) this.trigger = (ev.currentTarget as HTMLElement) ?? null;
    this.detail.set(null);
    this.reauthTarget.set({
      connectionId: card.connectionId,
      mechanism: card.reauthMechanism,
      name: card.connectionName ?? card.title,
    });
    this.autostart.set(card.reauthMechanism === 'DEVICE_CODE');
    this.oauthErrors.update(({ [card.provider!.id]: _, ...rest }) => rest);
    this.connecting.set(card.provider);
  }

  reauthFromDetail() {
    const card = this.detailCard();
    if (card) this.reauth(card, null);
  }

  private detailCard() {
    const d = this.detail();
    return (d && this.connected().find((c) => c.key === d.key)) || null;
  }

  cancelDisconnect() {
    const t = this.confirmTarget();
    this.confirmTarget.set(null);
    setTimeout(() => {
      const el = t?.returnFocus
        ? this.document.getElementById(t.returnFocus)
        : this.document.querySelector<HTMLElement>('dialog.detail .pd-foot .btn.danger');
      el?.focus();
    });
  }

  async confirmDisconnect() {
    const t = this.confirmTarget();
    if (!t || this.disconnecting()) return;
    this.disconnecting.set(true);
    try {
      const res = (
        t.action === 'signOut'
          ? await this.api.signOutLlmConnection(t.connectionId)
          : await this.api.deleteLlmConnection(t.connectionId)
      ) as DeleteConnectionResult | null;
      const revoked = !!res?.revoked;
      this.confirmTarget.set(null);
      this.detail.set(null);
      this.trigger = null;
      const base =
        t.action === 'signOut'
          ? `Se cerró la sesión de ${t.name}; la conexión se conserva`
          : t.action === 'delete'
            ? `Se eliminó la conexión ${t.name}`
            : `${t.name} se desconectó`;
      this.showNotice(revoked ? `${base} y se revocó el acceso de Nexo en el proveedor.` : `${base}.`, t.entry, 'info');
      await this.load(true);
      setTimeout(() => {
        const target =
          t.action === 'signOut'
            ? this.document.getElementById(`menu-btn-${t.connectionId}`)
            : this.document.getElementById('sec-available')?.closest('section')?.querySelector<HTMLElement>('button');
        target?.focus();
      });
    } catch (e) {
      this.toast.error(errorMessage(e));
      this.cancelDisconnect();
    } finally {
      this.disconnecting.set(false);
    }
  }

  modelCount(p: ProviderView) {
    const n = p.modelCount || p.suggestedModels?.length || 0;
    if (!n) return p.category === 'LOCAL' ? 'Los modelos de su servidor' : 'Modelos por descubrir';
    return `${n} ${n === 1 ? 'modelo' : 'modelos'}`;
  }

  private card(
    p: ProviderView | null,
    logo: BrandLogo,
    id: string,
    name: string,
    n: number,
    enabled: boolean,
    signedIn: boolean,
    signedOut: boolean,
  ): ConnectedCard {
    const title = p?.name ?? name;
    const how = signedOut ? 'Sesión cerrada' : signedIn ? 'Sesión iniciada' : p ? BILLING_LABELS[p.billing] : 'Conexión propia';
    return {
      key: id,
      title,
      subtitle: `${n} ${n === 1 ? 'modelo' : 'modelos'} · ${how}`,
      connectionName: name && name !== title ? name : null,
      logo,
      entry: { id: p?.id ?? id, name: title },
      status: enabled && !signedOut ? 'on' : 'off',
      statusLabel: signedOut ? 'Sesión cerrada' : enabled ? 'Activa' : 'Deshabilitada',
      provider: p,
      connectionId: id,
      enabled,
      platform: false,
      modelsKey: p?.id ?? `conn:${id}`,
      signedIn,
      signedOut,
      reauthMechanism: null,
    };
  }
}
