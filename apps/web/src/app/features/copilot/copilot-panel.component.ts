import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  model,
  OnDestroy,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { CopilotApi, CopilotStreamError } from '../../core/copilot.api';
import {
  COPILOT_MODE_LABELS,
  COPILOT_TOOL_LABELS,
  type CopilotApplyResult,
  type CopilotMode,
  type CopilotProposal,
  type CopilotQuota,
} from '../../core/copilot.models';
import type { Agent } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';
import { UsdPipe } from '../../shared/usd.pipe';
import { CopilotFeedbackComponent } from './copilot-feedback.component';
import { CopilotProposalCardComponent, type ProposalRef } from './copilot-proposal-card.component';

interface ToolStep {
  id: string;
  name: string;
  done: boolean;
  isError: boolean;
}

type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; messageId?: string }
  | { kind: 'tools'; steps: ToolStep[] }
  | { kind: 'notice' | 'error'; text: string }
  | { kind: 'proposal'; proposal: ProposalRef };

interface Conversation {
  sessionId: string | null;
  items: Item[];
  restored: boolean;
}

const STARTERS: Record<CopilotMode, string[]> = {
  CREATE: [],
  IMPROVE: [
    '¿Qué debería mejorar primero en este agente?',
    'Propón al menos 5 casos de evaluación para este agente',
    '¿Le faltan límites o herramientas para hacer bien su trabajo?',
  ],
  DIAGNOSE: [
    '¿Por qué está fallando este agente?',
    'Analiza las calificaciones negativas recientes',
    'Revisa las rutinas y evaluaciones con errores',
  ],
};

const MODE_HINTS: Record<CopilotMode, string> = {
  CREATE: 'Cuénteme qué debe resolver su agente y le propondré uno completo para revisar.',
  IMPROVE: 'Revisa la configuración del agente y propone mejoras que usted revisa antes de aplicar.',
  DIAGNOSE: 'Analiza calificaciones negativas, casos fallidos, rutinas con error y presupuesto.',
};

/** Clave de `sessionStorage` para retomar la sesión del Copilot de un agente y modo. */
const storageKey = (agentId: string | undefined, mode: CopilotMode, context: string) =>
  `nexo.copilot:${agentId ?? 'new'}:${mode}${mode === 'CREATE' ? ':' + context.slice(0, 40) : ''}`;

let seq = 0;

/**
 * Panel de Nexo Copilot (ADR 0006 D5). En variante `panel` es un panel lateral deslizable (detalle del agente, modos
 * Mejorar y Diagnosticar); en variante `page` ocupa la pantalla (entrevista al crear, modo CREATE).
 * El Copilot nunca modifica nada directamente: produce propuestas que el usuario revisa y aplica.
 */
@Component({
  selector: 'nx-copilot-panel',
  imports: [FormsModule, RouterLink, IconComponent, UsdPipe, CopilotProposalCardComponent, CopilotFeedbackComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './copilot-panel.component.html',
  styleUrl: './copilot-panel.component.scss',
  host: { '[class.cp-page]': "variant() === 'page'", '[class.open]': "variant() === 'page' || open()", '(document:keydown.escape)': 'onEscape($event)' },
})
export class CopilotPanelComponent implements OnDestroy {
  private readonly api = inject(CopilotApi);

  readonly variant = input<'panel' | 'page'>('panel');
  readonly open = model(false);
  readonly agent = input<Agent | null>(null);
  readonly modes = input<CopilotMode[]>(['IMPROVE', 'DIAGNOSE']);
  readonly mode = model<CopilotMode>('IMPROVE');
  /** Contexto inicial de la sesión (p. ej. la plantilla por industria elegida). */
  readonly context = input('');
  /** Sugerencias de inicio para el modo CREATE. */
  readonly starters = input<string[]>([]);
  readonly canApply = input(true);
  /** Id del elemento que recibe el foco al cerrar si el panel se abrió sin foco previo (p. ej. con el atajo). */
  readonly triggerId = input<string | null>(null);
  readonly applied = output<{ proposal: CopilotProposal; result: CopilotApplyResult }>();
  /** El usuario pidió ver la tarjeta de salud (enlace del aviso de cupo agotado). */
  readonly showHealth = output<void>();

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly composer = viewChild<ElementRef<HTMLTextAreaElement>>('composer');

  readonly uid = `cp-${++seq}`;
  readonly modeLabels = COPILOT_MODE_LABELS;
  readonly conversations = signal<Partial<Record<CopilotMode, Conversation>>>({});
  readonly items = computed(() => this.conversations()[this.mode()]?.items ?? []);
  readonly streaming = signal(false);
  readonly restoring = signal(false);
  readonly quota = signal<CopilotQuota | null>(null);
  readonly quotaBlocked = signal(false);
  readonly exhausted = computed(() => this.quotaBlocked() || (this.quota() ? this.quota()!.remainingUsd <= 0 : false));
  readonly quotaPct = computed(() => {
    const q = this.quota();
    return q && q.limitUsd > 0 ? Math.min(100, Math.round((q.usedUsd / q.limitUsd) * 100)) : 0;
  });
  readonly suggestions = computed(() => (this.mode() === 'CREATE' ? this.starters() : STARTERS[this.mode()]));
  readonly hint = computed(() => MODE_HINTS[this.mode()]);
  message = '';
  private abort?: AbortController;
  private returnFocus: HTMLElement | null = null;
  private wasOpen = false;

  constructor() {
    // Otro agente (el router reutiliza la página): conversaciones nuevas.
    let agentId: string | undefined;
    effect(() => {
      const id = this.agent()?.id;
      untracked(() => {
        if (agentId !== undefined && id !== agentId) {
          this.abort?.abort();
          this.conversations.set({});
        }
        agentId = id;
      });
    });
    // Al abrir: cupo, sesión previa y foco en el compositor; al cerrar, el foco vuelve al disparador.
    effect(() => {
      const isOpen = this.variant() === 'page' || this.open();
      const mode = this.mode();
      untracked(() => {
        if (!isOpen) {
          if (this.wasOpen) this.restoreFocus();
          this.wasOpen = false;
          return;
        }
        this.wasOpen = true;
        void this.refreshQuota();
        void this.restore(mode);
        if (this.variant() === 'panel' && !this.returnFocus) this.returnFocus = document.activeElement as HTMLElement | null;
        setTimeout(() => this.composer()?.nativeElement.focus());
      });
    });
  }

  ngOnDestroy() {
    this.abort?.abort();
  }

  close() {
    this.open.set(false);
  }

  /** Abre el panel con un mensaje precargado (p. ej. el `prompt` sugerido por un chequeo de salud). */
  prefill(prompt: string, mode?: CopilotMode) {
    if (mode && this.modes().includes(mode)) this.mode.set(mode);
    this.message = prompt;
    this.open.set(true);
    setTimeout(() => {
      const el = this.composer()?.nativeElement;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    });
  }

  setMode(m: CopilotMode) {
    if (this.streaming()) return;
    this.mode.set(m);
  }

  toolLabel(name: string) {
    return COPILOT_TOOL_LABELS[name] ?? `Usó ${name}`;
  }

  onEnter(e: KeyboardEvent) {
    if (e.shiftKey) return;
    e.preventDefault();
    void this.send();
  }

  /** Escape cierra el panel, salvo que haya un diálogo modal abierto (ese Escape es del diálogo). */
  onEscape(e: Event) {
    if (this.variant() !== 'panel' || !this.open() || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    this.close();
  }

  stop() {
    this.abort?.abort();
  }

  /** Nueva conversación en el modo actual (la sesión anterior queda en el servidor). */
  reset() {
    if (this.streaming()) return;
    sessionStorage.removeItem(this.key(this.mode()));
    this.setConv(this.mode(), { sessionId: null, items: [], restored: true });
  }

  async send(text = this.message.trim()) {
    if (!text || this.streaming() || this.exhausted()) return;
    const mode = this.mode();
    this.message = '';
    this.push(mode, { kind: 'user', text });
    this.streaming.set(true);
    this.abort = new AbortController();
    let current: Extract<Item, { kind: 'assistant' }> | null = null;
    let tools: Extract<Item, { kind: 'tools' }> | null = null;
    try {
      const sessionId = await this.ensureSession(mode);
      await this.api.sendMessage(
        sessionId,
        text,
        (e) => {
          switch (e.type) {
            case 'text':
              tools = null;
              if (!current) this.push(mode, (current = { kind: 'assistant', text: '' }));
              current.text += e.text;
              break;
            case 'tool_call':
              current = null;
              if (!tools) this.push(mode, (tools = { kind: 'tools', steps: [] }));
              tools.steps = [...tools.steps, { id: e.id, name: e.name, done: false, isError: false }];
              break;
            case 'tool_result':
              this.mapItems(mode, (i) =>
                i.kind === 'tools' && i.steps.some((s) => s.id === e.id)
                  ? Object.assign(i, { steps: i.steps.map((s) => (s.id === e.id ? { ...s, done: true, isError: e.isError } : s)) })
                  : i,
              );
              break;
            case 'proposal':
              current = tools = null;
              this.push(mode, { kind: 'proposal', proposal: { id: e.id, kind: e.kind, summary: e.summary, status: 'PENDING' } });
              break;
            case 'notice':
              current = tools = null;
              this.push(mode, { kind: 'notice', text: e.message });
              break;
            case 'done': {
              const last = this.lastAssistant(mode);
              if (last && e.messageId) last.messageId = e.messageId;
              current = tools = null;
              break;
            }
            case 'error':
              current = tools = null;
              this.push(mode, { kind: 'error', text: e.message });
              break;
          }
          this.touch(mode);
          queueMicrotask(() => this.scrollToEnd());
        },
        this.abort.signal,
      );
    } catch (e) {
      if ((e as Error).name === 'AbortError') this.push(mode, { kind: 'notice', text: 'Respuesta detenida.' });
      else if (e instanceof CopilotStreamError && (e.status === 402 || e.status === 429)) this.quotaBlocked.set(true);
      else this.push(mode, { kind: 'error', text: errorMessage(e) });
    } finally {
      this.streaming.set(false);
      this.touch(mode);
      void this.refreshQuota();
    }
  }

  onApplied(ev: { proposal: CopilotProposal; result: CopilotApplyResult }) {
    this.applied.emit(ev);
  }

  private key(mode: CopilotMode) {
    return storageKey(this.agent()?.id, mode, this.context());
  }

  private async ensureSession(mode: CopilotMode): Promise<string> {
    const existing = this.conversations()[mode]?.sessionId;
    if (existing) return existing;
    const ctx = this.context().trim();
    const s = await this.api.createSession({ mode, agentId: this.agent()?.id, context: ctx || undefined });
    sessionStorage.setItem(this.key(mode), s.id);
    const conv = this.conversations()[mode];
    this.setConv(mode, { sessionId: s.id, items: conv?.items ?? [], restored: true });
    return s.id;
  }

  /** Retoma la sesión guardada del modo (mensajes y propuestas) si existe. */
  private async restore(mode: CopilotMode) {
    if (this.conversations()[mode]?.restored) return;
    this.setConv(mode, { sessionId: null, items: [], restored: true });
    const id = sessionStorage.getItem(this.key(mode));
    if (!id) return;
    this.restoring.set(true);
    try {
      const s = await this.api.session(id);
      const items: Item[] = s.messages.map((m) =>
        m.role === 'user' ? { kind: 'user', text: m.text } : { kind: 'assistant', text: m.text, messageId: m.id },
      );
      for (const p of s.proposals) items.push({ kind: 'proposal', proposal: { id: p.id, kind: p.kind, summary: p.summary, status: p.status } });
      // Si el usuario ya escribió mientras se restauraba, se conserva lo nuevo al final.
      const now = this.conversations()[mode];
      this.setConv(mode, { sessionId: now?.sessionId ?? s.id, items: [...items, ...(now?.items ?? [])], restored: true });
      setTimeout(() => this.scrollToEnd());
    } catch {
      sessionStorage.removeItem(this.key(mode));
    } finally {
      this.restoring.set(false);
    }
  }

  private async refreshQuota() {
    try {
      const q = await this.api.quota();
      this.quota.set(q);
      this.quotaBlocked.set(q.remainingUsd <= 0);
    } catch {
      // El cupo es informativo: si falla, el servidor sigue aplicándolo al enviar.
    }
  }

  private lastAssistant(mode: CopilotMode) {
    const items = this.conversations()[mode]?.items ?? [];
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]!;
      if (it.kind === 'user') return null;
      if (it.kind === 'assistant') return it;
    }
    return null;
  }

  private setConv(mode: CopilotMode, conv: Conversation) {
    this.conversations.update((c) => ({ ...c, [mode]: conv }));
  }

  private push(mode: CopilotMode, item: Item) {
    const conv = this.conversations()[mode] ?? { sessionId: null, items: [], restored: true };
    this.setConv(mode, { ...conv, items: [...conv.items, item] });
  }

  private mapItems(mode: CopilotMode, fn: (i: Item) => Item) {
    const conv = this.conversations()[mode];
    if (conv) this.setConv(mode, { ...conv, items: conv.items.map(fn) });
  }

  /** Fuerza la detección de cambios tras mutar un elemento en su lugar (texto en streaming). */
  private touch(mode: CopilotMode) {
    const conv = this.conversations()[mode];
    if (conv) this.setConv(mode, { ...conv, items: [...conv.items] });
  }

  private restoreFocus() {
    const prev = this.returnFocus;
    this.returnFocus = null;
    const fallback = this.triggerId() ? document.getElementById(this.triggerId()!) : null;
    const el = prev && prev !== document.body && document.contains(prev) ? prev : fallback;
    el?.focus();
  }

  private scrollToEnd() {
    const el = this.scroller()?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }
}
