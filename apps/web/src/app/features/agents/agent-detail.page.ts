import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, OnInit, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AccessApi } from '../../core/access.api';
import { type AgentHealth, PERMISSION_LABELS, VISIBILITY_META } from '../../core/access.models';
import { ApiService, errorMessage } from '../../core/api.service';
import type { CopilotApplyNavigationState, CopilotApplyResult, CopilotProposal } from '../../core/copilot.models';
import { AuthService } from '../../core/auth.service';
import type { Agent, CatalogModel, Connector, Effort, OrgUnitOption, ProviderInfo } from '../../core/models';
import { StudioApi } from '../../core/studio.api';
import { type AgentProfile, EMPTY_PROFILE, type KnowledgeBase, normalizeProfile, type Skill } from '../../core/studio.models';
import { ToastService } from '../../core/toast.service';
import { TIER_LABELS, treeOrder } from '../../shared/budget';
import { ShareAudienceComponent } from '../../shared/agent-badges.component';
import { canManageAgentOwnership, canWriteAgent } from '../../shared/agent-permissions';
import { IconComponent } from '../../shared/icon.component';
import { formatUsd, NumberPipe } from '../../shared/usd.pipe';
import { DEFAULT_TARGET_SCORE } from '../../core/training.models';
import { AgentChatFeedbackComponent } from './agent-chat-feedback.component';
import { AgentExamplesComponent } from './agent-examples.component';
import { AgentProfileComponent } from './agent-profile.component';
import { AgentPromptPreviewComponent } from './agent-prompt-preview.component';
import { AgentRoutinesComponent } from './agent-routines.component';
import { AgentTrainingComponent } from './training/agent-training.component';
import { CopilotPanelComponent } from '../copilot/copilot-panel.component';
import { AgentHealthCardComponent } from './agent-health-card.component';
import { AgentLaunchDialogComponent } from './agent-launch-dialog.component';
import { AgentShareDialogComponent } from './agent-share-dialog.component';

interface ChatItem {
  kind: 'user' | 'assistant' | 'tool' | 'notice' | 'usage' | 'error';
  text?: string;
  tool?: { id: string; name: string; input: unknown; output?: string; isError?: boolean };
  needsApproval?: boolean;
  /** Turno del chat al que pertenece (respuestas del asistente). */
  turn?: number;
  /** Última respuesta del asistente en su turno: lleva la calificación (ADR 0004 D1). */
  final?: boolean;
  /** Mensaje del usuario que originó la respuesta y texto completo del turno, para la calificación. */
  userMessage?: string;
  response?: string;
}

export type AgentTab = 'profile' | 'model' | 'tools' | 'knowledge' | 'routines' | 'training' | 'preview';

/** Opción de modelo del catálogo con clave `"<providerId>:<modelId>"` (modelos de respaldo). */
interface ModelOption {
  key: string;
  providerLabel: string;
  model: CatalogModel;
}

const MAX_FALLBACKS = 3;

@Component({
  selector: 'nx-agent-detail',
  imports: [
    FormsModule,
    RouterLink,
    IconComponent,
    NumberPipe,
    AgentProfileComponent,
    AgentExamplesComponent,
    AgentRoutinesComponent,
    AgentPromptPreviewComponent,
    AgentTrainingComponent,
    AgentChatFeedbackComponent,
    CopilotPanelComponent,
    AgentHealthCardComponent,
    AgentLaunchDialogComponent,
    AgentShareDialogComponent,
    ShareAudienceComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agent-detail.page.html',
  styleUrl: './agent-detail.page.scss',
  host: { '(document:keydown)': 'onShortcut($event)' },
})
export class AgentDetailPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly studio = inject(StudioApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly access = inject(AccessApi);
  protected readonly auth = inject(AuthService);
  readonly id = input.required<string>();
  /** Pestaña inicial por query param (`?tab=routines`). */
  readonly initialTab = input<string | undefined>(undefined, { alias: 'tab' });
  private readonly scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');
  private readonly copilot = viewChild(CopilotPanelComponent);
  private readonly healthCard = viewChild(AgentHealthCardComponent);

  readonly agent = signal<Agent | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly providers = signal<ProviderInfo[]>([]);
  readonly units = signal<{ item: OrgUnitOption; depth: number }[]>([]);
  readonly tierLabels = TIER_LABELS;
  readonly connectors = signal<Connector[]>([]);
  readonly skills = signal<Skill[] | null>(null);
  readonly skillsError = signal<string | null>(null);
  readonly knowledgeBases = signal<KnowledgeBase[] | null>(null);
  readonly kbError = signal<string | null>(null);
  readonly tabs: { id: AgentTab; label: string }[] = [
    { id: 'profile', label: 'Perfil' },
    { id: 'model', label: 'Modelo' },
    { id: 'tools', label: 'Herramientas' },
    { id: 'knowledge', label: 'Conocimiento' },
    { id: 'routines', label: 'Rutinas' },
    { id: 'training', label: 'Entrenamiento' },
    { id: 'preview', label: 'Vista previa' },
  ];
  readonly tab = signal<AgentTab>('profile');

  // ----- Permisos, visibilidad, salud y lanzamiento (ADR 0006 / 0007) -----
  readonly visibilityMeta = VISIBILITY_META;
  readonly permissionLabels = PERMISSION_LABELS;
  /** Permiso efectivo; si la API aún no lo devuelve, se usa el rol del workspace. */
  readonly permission = computed(() => this.agent()?.myPermission ?? (this.auth.canEdit() ? 'EDIT' : 'USE'));
  /**
   * Edita como dueño o con share EDIT, con el rol del workspace como tope (un VIEWER solo edita sus agentes PRIVATE).
   * La administración (ADMIN_VIEW) ve la vista de gobierno de solo lectura.
   */
  readonly canEditAgent = computed(
    () =>
      (this.permission() === 'OWNER' || this.permission() === 'EDIT') &&
      canWriteAgent(this.permission(), this.auth.session()?.role, this.agent()?.visibility),
  );
  /** Eliminar: solo el dueño o ADMIN/OWNER del workspace (un share EDIT no basta) y, como en la API, con permiso de escritura. */
  readonly canDeleteAgent = computed(() => {
    const role = this.auth.session()?.role;
    return canWriteAgent(this.permission(), role, this.agent()?.visibility) && canManageAgentOwnership(this.permission(), role);
  });
  /** Ve la configuración completa (editores y gobierno de administración). */
  readonly seesConfig = computed(() => this.canEditAgent() || this.permission() === 'ADMIN_VIEW');
  readonly isOwner = computed(() => {
    const a = this.agent();
    return this.permission() === 'OWNER' || (!!a?.ownerId && a.ownerId === this.auth.me()?.id);
  });
  readonly copilotOpen = signal(false);
  /** Resumen de la propuesta del Copilot que creó este agente (llega como estado de navegación; ver `AgentNewPage`). */
  readonly copilotNotice = signal<CopilotApplyNavigationState['copilotApply'] | null>(null);
  readonly shareOpen = signal(false);
  readonly launchOpen = signal(false);
  readonly health = signal<AgentHealth | null>(null);
  readonly launchBusy = signal(false);
  readonly duplicating = signal(false);
  readonly saving = signal(false);
  readonly maxFallbacks = MAX_FALLBACKS;
  readonly efforts: { id: Effort; label: string }[] = [
    { id: 'low', label: 'Bajo — rápido y económico' },
    { id: 'medium', label: 'Medio — recomendado' },
    { id: 'high', label: 'Alto — más razonamiento' },
    { id: 'xhigh', label: 'Muy alto — tareas complejas' },
    { id: 'max', label: 'Máximo' },
  ];

  // Formulario
  form = {
    name: '',
    description: '',
    provider: 'anthropic',
    model: '',
    systemPrompt: '',
    effort: 'medium' as Effort,
    maxTurns: 12,
    costCenterId: null as string | null,
  };
  readonly profile = signal<AgentProfile>(normalizeProfile(EMPTY_PROFILE));
  readonly systemPrompt = signal('');
  readonly fallbacks = signal<string[]>([]);
  /** Meta de calidad del bucle de mejora (0.5–1); se guarda con el `PATCH /agents/:id` de «Guardar». */
  readonly targetScore = signal(DEFAULT_TARGET_SCORE);
  readonly toolSelection = signal(new Map<string, boolean>()); // operationId -> requiresApproval
  readonly skillSelection = signal(new Set<string>());
  readonly kbSelection = signal(new Set<string>());
  /** Cuentas (buzones/identidades) sobre las que actuará el agente: las de los conectores con operaciones elegidas. */
  readonly usedAccounts = computed(() => {
    const selected = this.toolSelection();
    const labels: string[] = [];
    for (const c of this.connectors()) {
      const label = c.account?.label;
      if (!label || labels.includes(label)) continue;
      if ((c.operations ?? []).some((op) => selected.has(op.id))) labels.push(label);
    }
    return labels;
  });
  fallbackDraft = '';
  /** Estado guardado, para detectar cambios y enviar solo los `PUT` necesarios. */
  private saved = { main: '', tools: '', skills: '', kbs: '' };

  /** Modelos del proveedor elegido (el formulario no es reactivo, por eso es un método y no un `computed`). */
  models(): CatalogModel[] {
    return this.providers().find((p) => p.id === this.form.provider)?.models ?? [];
  }

  /**
   * Por qué el modelo guardado del agente no se puede usar ahora (conexión deshabilitada o eliminada, sesión cerrada,
   * modelo deshabilitado). El catálogo solo trae conexiones y modelos habilitados; null si todo está bien.
   */
  modelIssue(): string | null {
    const a = this.agent();
    if (!a || !this.providers().length) return null;
    const p = this.providers().find((x) => x.id === a.provider);
    let issue: string;
    if (!p) issue = 'La conexión de IA de este agente está deshabilitada o se eliminó.';
    else if (!p.configured) {
      issue = p.system
        ? `«${p.label}» no está configurado en el servidor.`
        : `La conexión «${p.label}» no está lista: la sesión está cerrada o falta su credencial.`;
    } else if (!p.models.some((m) => m.id === a.model)) {
      issue = `El modelo «${a.model}» está deshabilitado o se eliminó de «${p.label}».`;
    } else return null;
    return `${issue} ${
      a.fallbackModels?.length
        ? 'Mientras tanto, las conversaciones usan el modelo de respaldo.'
        : 'Las conversaciones fallarán hasta que lo corrija o configure un modelo de respaldo.'
    }`;
  }

  readonly isAdmin = this.auth.isAdmin;

  selectedModel(): CatalogModel | undefined {
    return this.models().find((m) => m.id === this.form.model);
  }

  modelOption(m: CatalogModel) {
    return `${m.label} · ${TIER_LABELS[m.tier]} · ${formatUsd(m.inputUsdPerMTok)} / ${formatUsd(m.outputUsdPerMTok)} por MTok`;
  }

  price(v: number) {
    return formatUsd(v);
  }

  pad(depth: number) {
    return '   '.repeat(depth);
  }

  // Chat
  readonly chat = signal<ChatItem[]>([]);
  readonly streaming = signal(false);
  conversationId?: string;
  message = '';
  private lastMessage = '';
  private turnSeq = 0;
  private abort?: AbortController;

  /** Agente cargado; el router reutiliza la página al navegar a otro agente (duplicar, propuestas). */
  private loadedId: string | null = null;

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => {
        if (!this.loadedId || this.loadedId === id) return;
        this.newConversation();
        this.copilotOpen.set(false);
        this.health.set(null);
        this.agent.set(null);
        this.readCopilotNotice();
        void this.load();
      });
    });
  }

  async ngOnInit() {
    const t = this.initialTab();
    if (t && this.tabs.some((x) => x.id === t)) this.tab.set(t as AgentTab);
    this.readCopilotNotice();
    await this.load();
  }

  async load() {
    this.loadedId = this.id();
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [agent, providers, list, units] = await Promise.all([
        this.api.agent(this.id()),
        this.api.llmCatalog().catch(() => this.api.providers()),
        this.api.connectors(),
        this.api.orgUnits().catch(() => [] as OrgUnitOption[]),
      ]);
      this.providers.set(providers);
      this.units.set(treeOrder(units, (u) => u.id, (u) => u.parentId));
      this.connectors.set(await Promise.all(list.map((c) => this.api.connector(c.id))));
      this.apply(agent);
      // Con `?tab=` la pestaña puede quedar fuera de vista en móvil.
      setTimeout(() => document.getElementById(`tab-${this.tab()}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
      void this.loadSkills();
      void this.loadKnowledgeBases();
    } catch (e) {
      this.loadError.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async loadSkills() {
    this.skillsError.set(null);
    try {
      this.skills.set(await this.studio.skills());
    } catch (e) {
      this.skillsError.set(errorMessage(e));
    }
  }

  async loadKnowledgeBases() {
    this.kbError.set(null);
    try {
      this.knowledgeBases.set(await this.studio.knowledgeBases());
    } catch (e) {
      this.kbError.set(errorMessage(e));
    }
  }

  private apply(agent: Agent) {
    this.agent.set(agent);
    this.form = {
      name: agent.name,
      description: agent.description ?? '',
      provider: agent.provider,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      effort: agent.effort,
      maxTurns: agent.maxTurns,
      costCenterId: agent.costCenterId ?? null,
    };
    this.profile.set(normalizeProfile(agent.profile));
    this.systemPrompt.set(agent.systemPrompt ?? '');
    this.fallbacks.set([...(agent.fallbackModels ?? [])]);
    this.targetScore.set(agent.targetScore ?? DEFAULT_TARGET_SCORE);
    this.toolSelection.set(new Map((agent.tools ?? []).map((t) => [t.operationId, t.requiresApproval])));
    this.skillSelection.set(new Set((agent.skills ?? []).map((s) => s.id)));
    this.kbSelection.set(new Set((agent.knowledgeBases ?? []).map((k) => k.id)));
    this.saved = { main: this.mainSnapshot(), tools: this.toolsSnapshot(), skills: this.skillsSnapshot(), kbs: this.kbSnapshot() };
  }

  private mainPayload() {
    const clean = (list: string[]) => list.map((x) => x.trim()).filter(Boolean);
    const p = this.profile();
    return {
      ...this.form,
      systemPrompt: this.systemPrompt(),
      description: this.form.description || undefined,
      profile: {
        role: p.role.trim(),
        goals: clean(p.goals),
        responsibilities: clean(p.responsibilities),
        boundaries: clean(p.boundaries),
        tone: p.tone.trim(),
        outputFormat: p.outputFormat.trim(),
        language: p.language.trim(),
      },
      fallbackModels: this.fallbacks(),
      targetScore: this.targetScore(),
    };
  }

  private mainSnapshot = () => JSON.stringify(this.mainPayload());
  private toolsSnapshot = () => JSON.stringify([...this.toolSelection()].sort(([a], [b]) => a.localeCompare(b)));
  private skillsSnapshot = () => JSON.stringify([...this.skillSelection()].sort());
  private kbSnapshot = () => JSON.stringify([...this.kbSelection()].sort());

  /** Hay cambios sin guardar (se evalúa en cada ciclo; el formulario es un objeto plano). */
  dirty(): boolean {
    if (!this.agent()) return false;
    return (
      this.saved.main !== this.mainSnapshot() ||
      this.saved.tools !== this.toolsSnapshot() ||
      this.saved.skills !== this.skillsSnapshot() ||
      this.saved.kbs !== this.kbSnapshot()
    );
  }

  onProviderChange(id: string) {
    this.form.provider = id;
    this.form.model = this.providers().find((p) => p.id === id)?.models[0]?.id ?? '';
  }

  // ----- Modelos de respaldo -----

  allModelOptions(): ModelOption[] {
    return this.providers()
      .filter((p) => p.configured)
      .flatMap((p) => p.models.map((m) => ({ key: `${p.id}:${m.id}`, providerLabel: p.label, model: m })));
  }

  fallbackCandidates(): { provider: ProviderInfo; models: CatalogModel[] }[] {
    const primary = `${this.form.provider}:${this.form.model}`;
    const taken = new Set([primary, ...this.fallbacks()]);
    return this.providers()
      .filter((p) => p.configured)
      .map((p) => ({ provider: p, models: p.models.filter((m) => !taken.has(`${p.id}:${m.id}`)) }))
      .filter((g) => g.models.length > 0);
  }

  fallbackInfo(key: string): ModelOption | undefined {
    return this.allModelOptions().find((o) => o.key === key);
  }

  addFallback() {
    const key = this.fallbackDraft;
    if (!key || this.fallbacks().length >= MAX_FALLBACKS || this.fallbacks().includes(key)) return;
    this.fallbacks.update((l) => [...l, key]);
    this.fallbackDraft = '';
  }

  removeFallback(i: number) {
    this.fallbacks.update((l) => l.filter((_, j) => j !== i));
  }

  moveFallback(i: number, delta: number) {
    this.fallbacks.update((l) => {
      const j = i + delta;
      if (j < 0 || j >= l.length) return l;
      const next = [...l];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  // ----- Herramientas, skills y conocimiento -----

  toggleTool(opId: string, on: boolean) {
    const map = new Map(this.toolSelection());
    if (on) map.set(opId, false);
    else map.delete(opId);
    this.toolSelection.set(map);
  }

  toggleApproval(opId: string, value: boolean) {
    const map = new Map(this.toolSelection());
    map.set(opId, value);
    this.toolSelection.set(map);
  }

  toggleSkill(id: string, on: boolean) {
    const next = new Set(this.skillSelection());
    if (on) next.add(id);
    else next.delete(id);
    this.skillSelection.set(next);
  }

  toggleKb(id: string, on: boolean) {
    const next = new Set(this.kbSelection());
    if (on) next.add(id);
    else next.delete(id);
    this.kbSelection.set(next);
  }

  async save() {
    this.saving.set(true);
    try {
      const id = this.id();
      if (this.saved.main !== this.mainSnapshot()) await this.api.updateAgent(id, this.mainPayload());
      if (this.saved.tools !== this.toolsSnapshot()) {
        const tools = [...this.toolSelection()].map(([operationId, requiresApproval]) => ({ operationId, requiresApproval }));
        await this.api.setAgentTools(id, tools);
      }
      if (this.saved.skills !== this.skillsSnapshot()) await this.studio.setAgentSkills(id, [...this.skillSelection()]);
      if (this.saved.kbs !== this.kbSnapshot()) await this.studio.setAgentKnowledge(id, [...this.kbSelection()]);
      this.apply(await this.api.agent(id));
      this.toast.success('Agente guardado');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  /** Recarga el agente tras publicar una versión o aplicar una sugerencia (descarta cambios locales sin guardar). */
  async reloadAgent() {
    try {
      this.apply(await this.api.agent(this.id()));
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async remove() {
    if (!confirm('¿Eliminar este agente y sus conversaciones?')) return;
    try {
      await this.api.deleteAgent(this.id());
      await this.router.navigate(['/agents']);
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  // ----- Copilot, salud, lanzamiento y compartir -----

  /** Atajo Alt+Mayús+A para abrir o cerrar el Copilot. */
  onShortcut(e: KeyboardEvent) {
    if (e.altKey && e.shiftKey && e.code === 'KeyA' && this.canEditAgent()) {
      e.preventDefault();
      this.copilotOpen.update((v) => !v);
    }
  }

  openTabFromHealth(tab: string) {
    const t = this.tabs.find((x) => x.id === tab)?.id ?? 'profile';
    this.tab.set(t);
    setTimeout(() => {
      const el = document.getElementById(`tab-${t}`);
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      el?.focus();
    });
  }

  askCopilot(prompt: string) {
    this.copilot()?.prefill(prompt);
  }

  showHealth() {
    this.copilotOpen.set(false);
    setTimeout(() => this.healthCard()?.reveal());
  }

  /** Solo de la navegación en curso: al recargar la página el aviso no reaparece. */
  private readCopilotNotice() {
    // ngOnInit/effect pueden ejecutarse cuando la navegación ya terminó: se cae a la última navegación exitosa.
    const nav = this.router.currentNavigation() ?? this.router.lastSuccessfulNavigation;
    const state = nav?.extras.state as CopilotApplyNavigationState | undefined;
    const r = state?.copilotApply;
    this.copilotNotice.set(r && (r.pendingIntegrations?.length || r.warnings?.length) ? r : null);
  }

  async onCopilotApplied(ev: { proposal: CopilotProposal; result: CopilotApplyResult }) {
    const { agentId, ...summary } = ev.result;
    if (agentId && agentId !== this.id()) {
      this.copilotOpen.set(false);
      const state: CopilotApplyNavigationState = { copilotApply: summary };
      await this.router.navigate(['/agents', agentId], { state });
      return;
    }
    if (this.dirty()) this.toast.info('Se recargó el agente con los cambios aplicados; sus cambios sin guardar se descartaron.');
    await this.reloadAgent();
    void this.healthCard()?.load();
  }

  /** Actualiza solo los campos de acceso y lanzamiento, sin descartar cambios sin guardar. */
  mergeAccess(a: Agent) {
    this.agent.update((cur) =>
      cur
        ? {
            ...cur,
            visibility: a.visibility ?? cur.visibility,
            ownerId: a.ownerId ?? cur.ownerId,
            owner: a.owner ?? cur.owner,
            myPermission: a.myPermission ?? cur.myPermission,
            shares: a.shares ?? cur.shares,
            launchStatus: a.launchStatus ?? cur.launchStatus,
            launchedAt: a.launchedAt ?? cur.launchedAt,
            launchOverrideReason: a.launchOverrideReason ?? cur.launchOverrideReason,
          }
        : cur,
    );
  }

  onLaunched(a: Agent) {
    this.mergeAccess(a);
    if (!a.launchStatus) this.agent.update((cur) => (cur ? { ...cur, launchStatus: 'LAUNCHED', launchedAt: new Date().toISOString() } : cur));
    this.toast.success('Agente lanzado');
  }

  async unlaunch() {
    const a = this.agent();
    if (!a || this.launchBusy()) return;
    const extra = a.visibility === 'WORKSPACE' ? ' Dejará de estar disponible para toda la empresa.' : '';
    if (!confirm(`¿Retirar el lanzamiento de «${a.name}»? El servidor MCP y las rutinas dejarán de usarlo; el chat de prueba sigue funcionando.${extra}`)) return;
    this.launchBusy.set(true);
    try {
      const res = await this.access.unlaunch(a.id);
      this.mergeAccess(res ?? a);
      this.agent.update((cur) => (cur ? { ...cur, launchStatus: res?.launchStatus ?? 'DRAFT' } : cur));
      this.toast.success('Lanzamiento retirado: el agente vuelve a borrador');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.launchBusy.set(false);
    }
  }

  async duplicate() {
    const a = this.agent();
    if (!a || this.duplicating()) return;
    this.duplicating.set(true);
    try {
      const copy = await this.access.duplicate(a.id, `Copia de ${a.name}`);
      this.toast.success('Copia creada en sus agentes (Personal)');
      await this.router.navigate(['/agents', copy.id]);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.duplicating.set(false);
    }
  }

  // ----- Chat de prueba -----

  newConversation() {
    this.abort?.abort();
    this.conversationId = undefined;
    this.chat.set([]);
  }

  stop() {
    this.abort?.abort();
  }

  async send(text = this.message.trim(), approvedTools?: string[]) {
    if (!text || this.streaming()) return;
    this.message = '';
    this.lastMessage = text;
    this.push({ kind: 'user', text: approvedTools ? `✅ Aprobado: ${approvedTools.join(', ')} — ${text}` : text });
    this.streaming.set(true);
    this.abort = new AbortController();
    const turn = ++this.turnSeq;
    let current: ChatItem | null = null;

    try {
      await this.api.chatStream(
        this.id(),
        { message: text, conversationId: this.conversationId, approvedTools },
        (e) => {
          switch (e.type) {
            case 'text':
              if (!current) {
                current = { kind: 'assistant', text: '', turn };
                this.push(current);
              }
              current.text += e.text;
              this.chat.update((c) => [...c]);
              break;
            case 'tool_call':
              current = null;
              this.push({ kind: 'tool', tool: { id: e.id, name: e.name, input: e.input } });
              break;
            case 'tool_result':
              this.chat.update((items) =>
                items.map((i) =>
                  i.tool?.id === e.id
                    ? { ...i, tool: { ...i.tool, output: e.output, isError: e.isError }, needsApproval: e.output.startsWith('APROBACIÓN REQUERIDA') }
                    : i,
                ),
              );
              break;
            case 'notice':
              // Avisos del servidor, p. ej. cambio a un modelo de respaldo (ADR 0003 D1).
              current = null;
              this.push({ kind: 'notice', text: e.message });
              break;
            case 'done':
              this.conversationId = e.conversationId;
              current = null;
              if (e.usage || e.model) this.push({ kind: 'usage', text: this.usageLine(e.model, e.providerId, e.usage) });
              break;
            case 'error':
              current = null;
              this.push({ kind: 'error', text: e.message });
              break;
          }
          queueMicrotask(() => this.scrollToEnd());
        },
        this.abort.signal,
      );
    } catch (e) {
      if ((e as Error).name !== 'AbortError') this.push({ kind: 'error', text: errorMessage(e) });
    } finally {
      this.markFinal(turn, text);
      this.streaming.set(false);
    }
  }

  /** Marca la última respuesta del turno para calificarla con el texto completo del asistente en ese turno. */
  private markFinal(turn: number, userMessage: string) {
    const answers = this.chat().filter((i) => i.kind === 'assistant' && i.turn === turn && i.text?.trim());
    const last = answers.at(-1);
    if (!last) return;
    last.final = true;
    last.userMessage = userMessage;
    last.response = answers.map((i) => i.text!.trim()).join('\n\n');
    this.chat.update((c) => [...c]);
  }

  onEnter(e: KeyboardEvent) {
    if (e.shiftKey) return;
    e.preventDefault();
    void this.send();
  }

  approve(toolName: string) {
    void this.send(this.lastMessage, [toolName]);
  }

  pretty(v: unknown) {
    if (typeof v === 'string') {
      try {
        return JSON.stringify(JSON.parse(v), null, 2);
      } catch {
        return v;
      }
    }
    return JSON.stringify(v, null, 2);
  }

  /** Línea discreta bajo la respuesta: modelo usado, tokens y costo estimado. */
  private usageLine(model: string | undefined, providerId: string | undefined, usage: { inputTokens: number; outputTokens: number; costUsd: number } | undefined) {
    const n = new Intl.NumberFormat('es');
    const parts = [model ? `${model}${providerId ? ` (${providerId})` : ''}` : null];
    if (usage) {
      parts.push(`${n.format(usage.inputTokens)} tokens entrada · ${n.format(usage.outputTokens)} salida`);
      parts.push(formatUsd(usage.costUsd, 'precise'));
    }
    return parts.filter(Boolean).join(' · ');
  }

  private push(item: ChatItem) {
    this.chat.update((c) => [...c, item]);
  }

  private scrollToEnd() {
    const el = this.scroller()?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }
}
