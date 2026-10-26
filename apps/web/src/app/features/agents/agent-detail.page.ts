import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, OnInit, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AccessApi } from '../../core/access.api';
import { type AgentHealth, PERMISSION_LABELS, VISIBILITY_META } from '../../core/access.models';
import { ApiService, errorMessage } from '../../core/api.service';
import type { CopilotApplyNavigationState, CopilotApplyResult, CopilotProposal } from '../../core/copilot.models';
import { AuthService } from '../../core/auth.service';
import type { Agent, Cargo, CatalogModel, Connector, Effort, Operation, OrgMember, OrgUnitOption, ProviderInfo, RoutingPolicy } from '../../core/models';
import { NIVEL_LABELS } from '../../core/models';
import { type LifecycleActionId, lifecycleActions } from './agent-lifecycle.util';
import { StudioApi } from '../../core/studio.api';
import { type AgentProfile, EMPTY_PROFILE, type KnowledgeBase, normalizeProfile, type Skill } from '../../core/studio.models';
import { ToastService } from '../../core/toast.service';
import { TIER_LABELS, treeOrder } from '../../shared/budget';
import { LaunchBadgeComponent, ShareAudienceComponent } from '../../shared/agent-badges.component';
import { canManageAgentOwnership, canWriteAgent } from '../../shared/agent-permissions';
import { IconComponent } from '../../shared/icon.component';
import { IconPickerComponent } from '../../shared/icon-picker.component';
import { formatUsd, NumberPipe } from '../../shared/usd.pipe';
import { MarkdownPipe } from '../../shared/markdown.pipe';
import {
  type ChatTurnState,
  clampStudioRatio,
  DEFAULT_STUDIO_RATIO,
  friendlyError,
  isActiveTurnState,
  isSecurityNotice,
  parseStudioRatio,
  STUDIO_RATIO_STEP,
  studioRatioAt,
  toolSlug,
  turnStateLabel,
} from './agent-chat.util';
import { DEFAULT_TARGET_SCORE } from '../../core/training.models';
import { AgentChatFeedbackComponent } from './agent-chat-feedback.component';
import { AgentExamplesComponent } from './agent-examples.component';
import { AgentProfileComponent } from './agent-profile.component';
import { AgentSectionComponent, type SectionStatus } from './agent-section.component';
import { AgentPromptPreviewComponent } from './agent-prompt-preview.component';
import { AgentRoutinesComponent } from './agent-routines.component';
import { AgentExecutionParamsComponent } from './agent-execution-params.component';
import { AgentRoutingEditorComponent } from './agent-routing-editor.component';
import { normalizeRoutingPolicy } from './agent-routing.util';
import { AgentTrainingComponent } from './training/agent-training.component';
import { CopilotPanelComponent } from '../copilot/copilot-panel.component';
import { AgentHealthCardComponent } from './agent-health-card.component';
import { AgentLaunchDialogComponent } from './agent-launch-dialog.component';
import { AgentShareDialogComponent } from './agent-share-dialog.component';

interface ChatItem {
  kind: 'user' | 'assistant' | 'tool' | 'notice' | 'usage' | 'error';
  text?: string;
  tool?: { id: string; name: string; input: unknown; output?: string; isError?: boolean; startedAt?: number; finishedAt?: number };
  needsApproval?: boolean;
  /** Turno del chat al que pertenece (respuestas del asistente). */
  turn?: number;
  /** Última respuesta del asistente en su turno: lleva la calificación (ADR 0004 D1). */
  final?: boolean;
  /** Mensaje del usuario que originó la respuesta y texto completo del turno, para la calificación. */
  userMessage?: string;
  response?: string;
}

/** Vista activa del panel de prueba: separa la conversación de la actividad técnica y el diagnóstico (P0 UX). */
type ChatView = 'conversation' | 'activity' | 'diagnostics';

export type AgentTab = 'profile' | 'model' | 'tools' | 'knowledge' | 'routines' | 'training' | 'execution' | 'preview';

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
    IconPickerComponent,
    NumberPipe,
    MarkdownPipe,
    AgentProfileComponent,
    AgentSectionComponent,
    AgentExamplesComponent,
    AgentRoutinesComponent,
    AgentExecutionParamsComponent,
    AgentRoutingEditorComponent,
    AgentPromptPreviewComponent,
    AgentTrainingComponent,
    AgentChatFeedbackComponent,
    CopilotPanelComponent,
    AgentHealthCardComponent,
    AgentLaunchDialogComponent,
    AgentShareDialogComponent,
    ShareAudienceComponent,
    LaunchBadgeComponent,
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
  private readonly layoutEl = viewChild<ElementRef<HTMLDivElement>>('layoutEl');
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
    { id: 'execution', label: 'Ejecución' },
    { id: 'preview', label: 'Vista previa' },
  ];
  readonly tab = signal<AgentTab>('profile');

  // ----- Layout del estudio: columnas redimensionables y pantalla completa del chat (RX-6) -----
  private static readonly RATIO_KEY = 'nx.agentStudio.ratio';
  /** Fracción de ancho de la columna de configuración (0–1); el divisor arrastrable la ajusta. */
  readonly studioRatio = signal(this.readStudioRatio());
  /** El panel de prueba ocupa todo el ancho y oculta la configuración. */
  readonly chatFullscreen = signal(false);
  /** Arrastre del divisor en curso (bloquea la selección de texto y resalta el handle). */
  readonly resizing = signal(false);
  private releaseResize: (() => void) | null = null;

  private readStudioRatio(): number {
    try {
      return parseStudioRatio(localStorage.getItem(AgentDetailPage.RATIO_KEY));
    } catch {
      return DEFAULT_STUDIO_RATIO;
    }
  }

  private persistStudioRatio(ratio: number): void {
    try {
      localStorage.setItem(AgentDetailPage.RATIO_KEY, String(ratio));
    } catch {
      /* Sin persistencia (modo privado, cuota): la proporción solo vive en esta sesión. */
    }
  }

  /** Comienza a arrastrar el divisor; escucha el puntero a nivel de ventana hasta soltarlo. */
  startResize(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    ev.preventDefault();
    this.resizing.set(true);
    const move = (e: PointerEvent) => this.resizeTo(e.clientX);
    const up = () => {
      this.releaseResize?.();
      this.releaseResize = null;
      this.resizing.set(false);
      this.persistStudioRatio(this.studioRatio());
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    this.releaseResize = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }

  private resizeTo(clientX: number): void {
    const el = this.layoutEl()?.nativeElement;
    if (el) this.studioRatio.set(studioRatioAt(clientX, el.getBoundingClientRect()));
  }

  /** Teclado sobre el divisor: flechas ajustan la proporción; Inicio/Fin van a los extremos. */
  onResizeKey(e: KeyboardEvent): void {
    const delta =
      e.key === 'ArrowLeft'
        ? -STUDIO_RATIO_STEP
        : e.key === 'ArrowRight'
          ? STUDIO_RATIO_STEP
          : e.key === 'Home'
            ? -1
            : e.key === 'End'
              ? 1
              : 0;
    if (!delta) return;
    e.preventDefault();
    this.studioRatio.update((r) => clampStudioRatio(r + delta));
    this.persistStudioRatio(this.studioRatio());
  }

  toggleFullscreen(): void {
    this.chatFullscreen.update((v) => !v);
  }

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
  /** Edición inline del nombre desde el título del encabezado. */
  readonly editingName = signal(false);
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
  /** Ícono del agente (nombre del mapa de `IconComponent`); `null` = ícono por defecto (`bot`). */
  readonly icon = signal<string | null>(null);
  // ----- Expediente del empleado digital (E2/RF02/RF04) -----
  readonly nivelLabels = NIVEL_LABELS;
  /** Cargos activos del catálogo (más el ya asignado aunque esté inactivo), para el selector de cargo. */
  readonly cargos = signal<Cargo[]>([]);
  /** Miembros del workspace para elegir responsable/suplente (solo ADMIN los lista; vacío en otro caso). */
  readonly members = signal<OrgMember[]>([]);
  readonly membersUnavailable = signal(false);
  readonly cargoId = signal<string | null>(null);
  readonly responsableUserId = signal<string | null>(null);
  readonly suplenteUserId = signal<string | null>(null);
  /** Cargos que se ofrecen en el selector: los activos y, si aplica, el actualmente asignado aunque esté inactivo. */
  readonly cargoOptions = computed(() => {
    const current = this.cargoId();
    return this.cargos()
      .filter((c) => c.activo || c.id === current)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  });
  readonly memberOptions = computed(() => [...this.members()].sort((a, b) => a.name.localeCompare(b.name, 'es')));
  /** Acciones de ciclo de vida disponibles según el estado actual (RF05/RF06). */
  readonly lifecycleActionList = computed(() => lifecycleActions(this.agent()?.launchStatus));
  readonly lifecycleBusy = signal(false);
  readonly systemPrompt = signal('');
  readonly fallbacks = signal<string[]>([]);
  /** Política de enrutamiento multi-modelo (ADR 0010); `null` = principal + respaldos. Se guarda con «Guardar». */
  readonly routing = signal<RoutingPolicy | null>(null);
  /** Meta de calidad del bucle de mejora (0.5–1); se guarda con el `PATCH /agents/:id` de «Guardar». */
  readonly targetScore = signal(DEFAULT_TARGET_SCORE);
  readonly toolSelection = signal(new Map<string, boolean>()); // operationId -> requiresApproval
  readonly skillSelection = signal(new Set<string>());
  readonly kbSelection = signal(new Set<string>());
  /** Bases en las que el agente puede escribir (auto-aprendizaje con save_knowledge). */
  readonly kbWritable = signal(new Set<string>());
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
  /** Vista activa del panel: Conversación (default) / Actividad / Diagnóstico. */
  readonly chatView = signal<ChatView>('conversation');
  /** Conversación: solo lo que el usuario necesita leer (mensajes, respuestas, aprobaciones y errores funcionales). */
  readonly conversationItems = computed(() =>
    this.chat().filter(
      (i) => i.kind === 'user' || i.kind === 'assistant' || i.kind === 'error' || (i.kind === 'tool' && i.needsApproval),
    ),
  );
  /** Actividad: qué hizo el agente (herramientas, avisos informativos, consumo). La seguridad va agrupada aparte. */
  readonly activityItems = computed(() =>
    this.chat().filter(
      (i) => (i.kind === 'tool' && !i.needsApproval) || i.kind === 'usage' || (i.kind === 'notice' && !isSecurityNotice(i)),
    ),
  );
  /** Eventos de protección de datos (DataGuard) de la ejecución: se muestran agrupados en un solo indicador. */
  readonly securityItems = computed(() => this.chat().filter(isSecurityNotice));
  /** Nº de elementos para el badge de la pestaña Actividad: eventos + un grupo de seguridad si lo hay. */
  readonly activityBadge = computed(() => this.activityItems().length + (this.securityItems().length ? 1 : 0));
  readonly streaming = signal(false);
  /** Estado del turno en curso (máquina de estados de interfaz ligada a eventos reales del backend). */
  readonly turnState = signal<ChatTurnState>('idle');
  /** Herramienta que el agente está consultando (para el indicador «Consultando: …»). */
  readonly currentTool = signal<string | undefined>(undefined);
  /** Texto del indicador de progreso; `null` cuando no hay actividad que mostrar. */
  readonly turnStatus = computed(() => turnStateLabel(this.turnState(), this.currentTool()));
  readonly turnActive = computed(() => isActiveTurnState(this.turnState()));
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
      const [agent, providers, list, units, cargos] = await Promise.all([
        this.api.agent(this.id()),
        this.api.llmCatalog().catch(() => this.api.providers()),
        this.api.connectors(),
        this.api.orgUnits().catch(() => [] as OrgUnitOption[]),
        this.api.cargos().catch(() => [] as Cargo[]),
      ]);
      this.providers.set(providers);
      this.units.set(treeOrder(units, (u) => u.id, (u) => u.parentId));
      this.connectors.set(await Promise.all(list.map((c) => this.api.connector(c.id))));
      this.cargos.set(cargos);
      // Los miembros solo los lista la administración; para un EDITOR sin ese rol el selector se degrada con un aviso.
      if (this.auth.isAdmin()) {
        this.api.orgMembers().then(
          (m) => this.members.set(m),
          () => this.membersUnavailable.set(true),
        );
      } else {
        this.membersUnavailable.set(true);
      }
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
    this.icon.set(agent.icon ?? null);
    this.cargoId.set(agent.cargoId ?? null);
    this.responsableUserId.set(agent.responsableUserId ?? null);
    this.suplenteUserId.set(agent.suplenteUserId ?? null);
    this.systemPrompt.set(agent.systemPrompt ?? '');
    this.fallbacks.set([...(agent.fallbackModels ?? [])]);
    this.routing.set(agent.routing ? structuredClone(agent.routing) : null);
    this.targetScore.set(agent.targetScore ?? DEFAULT_TARGET_SCORE);
    this.toolSelection.set(new Map((agent.tools ?? []).map((t) => [t.operationId, t.requiresApproval])));
    this.skillSelection.set(new Set((agent.skills ?? []).map((s) => s.id)));
    this.kbSelection.set(new Set((agent.knowledgeBases ?? []).map((k) => k.id)));
    this.kbWritable.set(new Set((agent.knowledge ?? []).filter((k) => k.canWrite).map((k) => k.knowledgeBaseId)));
    this.saved = { main: this.mainSnapshot(), tools: this.toolsSnapshot(), skills: this.skillsSnapshot(), kbs: this.kbSnapshot() };
  }

  private mainPayload() {
    const clean = (list: string[]) => list.map((x) => x.trim()).filter(Boolean);
    const p = this.profile();
    return {
      ...this.form,
      systemPrompt: this.systemPrompt(),
      description: this.form.description || undefined,
      icon: this.icon(),
      cargoId: this.cargoId(),
      responsableUserId: this.responsableUserId(),
      suplenteUserId: this.suplenteUserId(),
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
      // `null` = comportamiento actual; normaliza rangos y preserva `verify` (Fase 3) tal cual venga del servidor.
      routing: normalizeRoutingPolicy(this.routing()),
      targetScore: this.targetScore(),
    };
  }

  private mainSnapshot = () => JSON.stringify(this.mainPayload());
  private toolsSnapshot = () => JSON.stringify([...this.toolSelection()].sort(([a], [b]) => a.localeCompare(b)));
  private skillsSnapshot = () => JSON.stringify([...this.skillSelection()].sort());
  private kbSnapshot = () =>
    JSON.stringify({ ids: [...this.kbSelection()].sort(), write: [...this.kbWritable()].sort() });

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

  /** Estado de la sección «Identidad»: el nombre es obligatorio (RX-7). */
  identityStatus(): SectionStatus {
    return this.form.name.trim() ? 'complete' : 'incomplete';
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

  /** Filtro de operaciones (por nombre, descripción o clave) para no tener que desplazarse entre muchas. */
  readonly toolFilter = signal('');
  /** Grupos (conectores) plegados/desplegados manualmente; sin entrada, se usa el estado por defecto. */
  private readonly groupOverride = signal(new Map<string, boolean>());

  /** Operaciones del conector que pasan el filtro actual (todas si no hay filtro). */
  filteredOps(c: Connector): Operation[] {
    const q = this.toolFilter().trim().toLowerCase();
    const ops = c.operations ?? [];
    if (!q) return ops;
    return ops.filter((op) => `${op.name} ${op.description ?? ''} ${op.key}`.toLowerCase().includes(q));
  }

  /** Operaciones de este conector ya seleccionadas (para el contador del encabezado). */
  selectedCount(c: Connector): number {
    const sel = this.toolSelection();
    return (c.operations ?? []).filter((op) => sel.has(op.id)).length;
  }

  /** ¿El grupo está desplegado? Con filtro, se abre si tiene coincidencias; si no, por override o por defecto. */
  isGroupOpen(c: Connector): boolean {
    if (this.toolFilter().trim()) return this.filteredOps(c).length > 0;
    const override = this.groupOverride().get(c.id);
    if (override !== undefined) return override;
    return this.connectors().length <= 2 || this.selectedCount(c) > 0;
  }

  toggleGroup(c: Connector): void {
    if (this.toolFilter().trim()) return; // con filtro el estado lo decide la búsqueda
    const map = new Map(this.groupOverride());
    map.set(c.id, !this.isGroupOpen(c));
    this.groupOverride.set(map);
  }

  /** Marca o desmarca todas las operaciones visibles (filtradas) del conector. */
  selectAllInGroup(c: Connector, on: boolean): void {
    const map = new Map(this.toolSelection());
    for (const op of this.filteredOps(c)) {
      if (on) {
        if (!map.has(op.id)) map.set(op.id, false);
      } else {
        map.delete(op.id);
      }
    }
    this.toolSelection.set(map);
  }

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
    if (!on && this.kbWritable().has(id)) this.toggleKbWrite(id, false); // sin la base no tiene sentido escribir en ella
  }

  /** Permite (o no) que el agente aprenda escribiendo en esta base con la herramienta save_knowledge. */
  toggleKbWrite(id: string, on: boolean) {
    const next = new Set(this.kbWritable());
    if (on) next.add(id);
    else next.delete(id);
    this.kbWritable.set(next);
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
      if (this.saved.kbs !== this.kbSnapshot())
        await this.studio.setAgentKnowledge(id, [...this.kbSelection()], [...this.kbWritable()]);
      this.apply(await this.api.agent(id));
      this.toast.success('Agente guardado');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  /** Abre la edición inline del nombre desde el título (sincroniza el campo con el valor guardado). */
  startRenaming() {
    if (!this.canEditAgent()) return;
    this.form.name = this.agent()?.name ?? this.form.name;
    this.editingName.set(true);
  }

  /** Cierra la edición inline descartando el cambio de nombre. */
  cancelRenaming() {
    this.form.name = this.agent()?.name ?? this.form.name;
    this.editingName.set(false);
  }

  /** Confirma el nuevo nombre: guarda si cambió (reusa el flujo de guardado) y cierra la edición. */
  async commitRenaming() {
    const name = this.form.name.trim();
    if (!name) return;
    this.editingName.set(false);
    if (name !== (this.agent()?.name ?? '')) {
      this.form.name = name;
      await this.save();
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
    if (e.key === 'Escape' && this.chatFullscreen()) {
      this.chatFullscreen.set(false);
      return;
    }
    if (e.altKey && e.shiftKey && e.code === 'KeyA' && this.canEditAgent()) {
      e.preventDefault();
      this.copilotOpen.update((v) => !v);
    }
  }

  /** Vistas del chat visibles según el permiso (Diagnóstico solo para quien puede editar). */
  private chatViews(): ChatView[] {
    return this.canEditAgent() ? ['conversation', 'activity', 'diagnostics'] : ['conversation', 'activity'];
  }

  /**
   * Navegación por teclado del grupo de pestañas del chat (patrón ARIA «tablist»): flechas izquierda/derecha
   * recorren las vistas, Inicio/Fin saltan a los extremos. Mueve el foco a la pestaña activada.
   */
  onChatViewKey(e: KeyboardEvent) {
    const views = this.chatViews();
    const current = views.indexOf(this.chatView());
    let next = current;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (current + 1) % views.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (current - 1 + views.length) % views.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = views.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const view = views[next];
    this.chatView.set(view);
    setTimeout(() => document.getElementById(`chat-tab-${view}`)?.focus());
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
    this.toast.success('Agente publicado');
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

  /**
   * Ejecuta una acción de ciclo de vida (RF05/RF06). `launch` abre el diálogo de publicación (garantía de calidad);
   * `unlaunch` reusa el flujo existente; el resto llama su endpoint directo y maneja el 409 (p. ej. publicar sin
   * responsable, o una transición no permitida) con un mensaje claro.
   */
  async runLifecycle(action: LifecycleActionId) {
    const a = this.agent();
    if (!a || this.lifecycleBusy() || this.launchBusy()) return;
    if (action === 'launch') {
      if (!a.responsableUserId) {
        this.toast.error('Asigne un responsable antes de publicar: elíjalo en Perfil → Identidad.');
        this.tab.set('profile');
        return;
      }
      this.launchOpen.set(true);
      return;
    }
    if (action === 'unlaunch') {
      void this.unlaunch();
      return;
    }
    if (action === 'retire' && !confirm(`¿Retirar «${a.name}»? Es un estado final: dejará de ejecutarse (rutinas y MCP) y conservará su expediente, pero no podrá reactivarlo.`)) return;
    if (action === 'suspend' && !confirm(`¿Suspender «${a.name}»? Dejará de ejecutar rutinas y de estar disponible por MCP; podrá reactivarlo más tarde.`)) return;
    this.lifecycleBusy.set(true);
    try {
      const res = await this.callTransition(action, a.id);
      this.mergeAccess(res);
      if (res?.launchStatus) this.agent.update((cur) => (cur ? { ...cur, launchStatus: res.launchStatus } : cur));
      this.toast.success(this.lifecycleToast(action));
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.lifecycleBusy.set(false);
    }
  }

  private callTransition(action: Exclude<LifecycleActionId, 'launch' | 'unlaunch'>, id: string) {
    switch (action) {
      case 'submit-validation':
        return this.access.submitForValidation(id);
      case 'suspend':
        return this.access.suspend(id);
      case 'reactivate':
        return this.access.reactivate(id);
      case 'retire':
        return this.access.retire(id);
    }
  }

  private lifecycleToast(action: Exclude<LifecycleActionId, 'launch' | 'unlaunch'>): string {
    return {
      'submit-validation': 'Agente enviado a validación',
      suspend: 'Agente suspendido',
      reactivate: 'Agente reactivado',
      retire: 'Agente retirado',
    }[action];
  }

  /** Nombre legible del miembro por id (para mostrar el responsable asignado cuando se puede listar). */
  memberName(id: string | null): string | null {
    if (!id) return null;
    return this.members().find((m) => m.userId === id)?.name ?? null;
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
    this.chatView.set('conversation');
    this.turnState.set('idle');
    this.currentTool.set(undefined);
  }

  /** Nombre legible de una herramienta a partir de su identificador técnico (conector__operación o tool interna). */
  friendlyTool(name: string): string {
    const internal: Record<string, string> = {
      load_skill: 'Cargar una habilidad',
      search_knowledge: 'Buscar en el conocimiento',
      save_knowledge: 'Guardar en el conocimiento',
    };
    if (internal[name]) return internal[name];
    for (const c of this.connectors()) {
      for (const op of c.operations ?? []) {
        if (toolSlug(c.name, op.key) === name) return `${c.name} · ${op.name}`;
      }
    }
    return name;
  }

  /** Duración aproximada (medida en el cliente) de una ejecución de herramienta. `null` si aún no terminó. */
  toolDuration(t: { startedAt?: number; finishedAt?: number }): string | null {
    if (!t.startedAt || !t.finishedAt) return null;
    return `${((t.finishedAt - t.startedAt) / 1000).toFixed(1)} s`;
  }

  stop() {
    this.abort?.abort();
  }

  /** Expone el mapeo de errores a la plantilla (causa comprensible en la conversación). */
  readonly friendlyError = friendlyError;

  /** Reintenta el último mensaje enviado (acción del aviso de error). */
  retry() {
    if (this.lastMessage && !this.streaming()) void this.send(this.lastMessage);
  }

  async send(text = this.message.trim(), approvedTools?: string[]) {
    if (!text || this.streaming()) return;
    this.message = '';
    this.lastMessage = text;
    this.push({ kind: 'user', text: approvedTools ? `✅ Aprobado: ${approvedTools.join(', ')} — ${text}` : text });
    this.streaming.set(true);
    this.turnState.set('thinking');
    this.currentTool.set(undefined);
    this.abort = new AbortController();
    const turn = ++this.turnSeq;
    let current: ChatItem | null = null;
    let truncated = false; // una respuesta parcial (límite de tokens o de turnos) termina en estado 'partial'

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
              this.turnState.set('streaming');
              this.currentTool.set(undefined);
              this.chat.update((c) => [...c]);
              break;
            case 'tool_call':
              current = null;
              this.turnState.set('tool');
              this.currentTool.set(this.friendlyTool(e.name));
              this.push({ kind: 'tool', tool: { id: e.id, name: e.name, input: e.input, startedAt: Date.now() } });
              break;
            case 'tool_result': {
              const needsApproval = e.output.startsWith('APROBACIÓN REQUERIDA');
              this.turnState.set(needsApproval ? 'awaiting_approval' : 'thinking');
              this.currentTool.set(undefined);
              this.chat.update((items) =>
                items.map((i) =>
                  i.tool?.id === e.id
                    ? {
                        ...i,
                        tool: { ...i.tool, output: e.output, isError: e.isError, finishedAt: Date.now() },
                        needsApproval,
                      }
                    : i,
                ),
              );
              break;
            }
            case 'notice':
              // Avisos del servidor, p. ej. cambio a un modelo de respaldo (ADR 0003 D1).
              current = null;
              if (/truncad|máximo de .* turnos/i.test(e.message)) truncated = true;
              this.push({ kind: 'notice', text: e.message });
              break;
            case 'done':
              this.conversationId = e.conversationId;
              current = null;
              this.turnState.set(truncated ? 'partial' : 'completed');
              this.currentTool.set(undefined);
              if (e.usage || e.model) this.push({ kind: 'usage', text: this.usageLine(e.model, e.providerId, e.usage) });
              break;
            case 'error':
              current = null;
              this.turnState.set('failed');
              this.currentTool.set(undefined);
              this.push({ kind: 'error', text: e.message });
              break;
          }
          queueMicrotask(() => this.scrollToEnd());
        },
        this.abort.signal,
      );
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        this.turnState.set('cancelled');
      } else {
        this.turnState.set('failed');
        this.push({ kind: 'error', text: errorMessage(e) });
      }
    } finally {
      this.currentTool.set(undefined);
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
