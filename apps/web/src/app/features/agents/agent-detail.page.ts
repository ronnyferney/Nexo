import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { Agent, Connector, Effort, ProviderInfo } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

interface ChatItem {
  kind: 'user' | 'assistant' | 'tool' | 'notice';
  text?: string;
  tool?: { id: string; name: string; input: unknown; output?: string; isError?: boolean };
  needsApproval?: boolean;
}

@Component({
  selector: 'nx-agent-detail',
  imports: [FormsModule, RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agent-detail.page.html',
  styleUrl: './agent-detail.page.scss',
})
export class AgentDetailPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  readonly id = input.required<string>();
  private readonly scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');

  readonly agent = signal<Agent | null>(null);
  readonly providers = signal<ProviderInfo[]>([]);
  readonly connectors = signal<Connector[]>([]);
  readonly tab = signal<'config' | 'tools'>('config');
  readonly saving = signal(false);
  readonly efforts: { id: Effort; label: string }[] = [
    { id: 'low', label: 'Bajo — rápido y económico' },
    { id: 'medium', label: 'Medio — recomendado' },
    { id: 'high', label: 'Alto — más razonamiento' },
    { id: 'xhigh', label: 'Muy alto — tareas complejas' },
    { id: 'max', label: 'Máximo' },
  ];

  // Formulario
  form = { name: '', description: '', provider: 'anthropic', model: '', systemPrompt: '', effort: 'medium' as Effort, maxTurns: 12 };
  readonly toolSelection = signal(new Map<string, boolean>()); // operationId -> requiresApproval

  readonly models = computed(() => this.providers().find((p) => p.id === this.form.provider)?.models ?? []);

  // Chat
  readonly chat = signal<ChatItem[]>([]);
  readonly streaming = signal(false);
  conversationId?: string;
  message = '';
  private lastMessage = '';
  private abort?: AbortController;

  async ngOnInit() {
    const [agent, providers, list] = await Promise.all([this.api.agent(this.id()), this.api.providers(), this.api.connectors()]);
    this.providers.set(providers);
    this.connectors.set(await Promise.all(list.map((c) => this.api.connector(c.id))));
    this.apply(agent);
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
    };
    this.toolSelection.set(new Map((agent.tools ?? []).map((t) => [t.operationId, t.requiresApproval])));
  }

  onProviderChange(id: string) {
    this.form.provider = id;
    this.form.model = this.providers().find((p) => p.id === id)?.models[0]?.id ?? '';
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

  async save() {
    this.saving.set(true);
    try {
      await this.api.updateAgent(this.id(), { ...this.form, description: this.form.description || undefined });
      const tools = [...this.toolSelection()].map(([operationId, requiresApproval]) => ({ operationId, requiresApproval }));
      this.apply(await this.api.setAgentTools(this.id(), tools));
      this.toast.success('Agente guardado');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  async remove() {
    if (!confirm('¿Eliminar este agente y sus conversaciones?')) return;
    await this.api.deleteAgent(this.id());
    await this.router.navigate(['/agents']);
  }

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
    let current: ChatItem | null = null;

    try {
      await this.api.chatStream(
        this.id(),
        { message: text, conversationId: this.conversationId, approvedTools },
        (e) => {
          switch (e.type) {
            case 'text':
              if (!current) {
                current = { kind: 'assistant', text: '' };
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
              this.push({ kind: 'notice', text: e.message });
              break;
            case 'done':
              this.conversationId = e.conversationId;
              break;
            case 'error':
              this.push({ kind: 'notice', text: `Error: ${e.message}` });
              break;
          }
          queueMicrotask(() => this.scrollToEnd());
        },
        this.abort.signal,
      );
    } catch (e) {
      if ((e as Error).name !== 'AbortError') this.push({ kind: 'notice', text: `Error: ${errorMessage(e)}` });
    } finally {
      this.streaming.set(false);
    }
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

  private push(item: ChatItem) {
    this.chat.update((c) => [...c, item]);
  }

  private scrollToEnd() {
    const el = this.scroller()?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }
}
