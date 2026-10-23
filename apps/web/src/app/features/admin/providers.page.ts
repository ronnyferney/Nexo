import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../core/api.service';
import type { LlmConnection, LlmConnectionUpdateInput, LlmKind, LlmModel, LlmModelInput, ModelTier, ProviderInfo } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { KIND_LABELS, TIER_LABELS } from '../../shared/budget';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { UsdPipe } from '../../shared/usd.pipe';

interface ConnectionDraft {
  id: string | null;
  name: string;
  kind: LlmKind;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  /** Valores originales para enviar solo lo que cambió al editar. */
  original?: LlmConnection;
}

interface ModelDraft {
  connectionId: string;
  id: string | null;
  modelId: string;
  label: string;
  tier: ModelTier;
  inputUsdPerMTok: number | null;
  outputUsdPerMTok: number | null;
  cacheReadUsdPerMTok: number | null;
  enabled: boolean;
}

@Component({
  selector: 'nx-admin-providers',
  imports: [FormsModule, NgTemplateOutlet, IconComponent, RelativeTimePipe, UsdPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './providers.page.html',
})
export class ProvidersPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly kinds: LlmKind[] = ['ANTHROPIC', 'OPENAI_COMPATIBLE', 'MOCK'];
  readonly tiers: ModelTier[] = ['PREMIUM', 'STANDARD', 'ECONOMY'];
  readonly kindLabels = KIND_LABELS;
  readonly tierLabels = TIER_LABELS;
  readonly baseUrlExamples = [
    { label: 'OpenAI', url: 'https://api.openai.com/v1' },
    { label: 'Ollama (local)', url: 'http://localhost:11434/v1' },
    { label: 'Azure OpenAI', url: 'https://<recurso>.openai.azure.com/openai/v1' },
    { label: 'Google Gemini (compatible)', url: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  ];

  readonly connections = signal<LlmConnection[]>([]);
  readonly catalog = signal<ProviderInfo[]>([]);
  readonly systemConnections = computed(() => this.catalog().filter((p) => p.system));
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly conn = signal<ConnectionDraft | null>(null);
  readonly savingConn = signal(false);
  readonly model = signal<ModelDraft | null>(null);
  readonly savingModel = signal(false);
  readonly testing = signal<string | null>(null);
  readonly testResults = signal<Record<string, { ok: boolean; message: string }>>({});

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [connections, catalog] = await Promise.all([this.api.llmConnections(), this.api.llmCatalog().catch(() => [])]);
      this.connections.set(connections);
      this.catalog.set(catalog);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  // ----- Conexiones -----

  newConnection() {
    this.conn.set({ id: null, name: '', kind: 'OPENAI_COMPATIBLE', baseUrl: '', apiKey: '', enabled: true });
  }

  editConnection(c: LlmConnection) {
    this.conn.set({ id: c.id, name: c.name, kind: c.kind, baseUrl: c.baseUrl ?? '', apiKey: '', enabled: c.enabled, original: c });
  }

  connInvalid(d: ConnectionDraft) {
    if (d.name.trim().length < 2) return true;
    if (d.kind === 'OPENAI_COMPATIBLE' && !d.baseUrl.trim()) return true;
    return false;
  }

  async saveConnection() {
    const d = this.conn();
    if (!d || this.connInvalid(d)) return;
    this.savingConn.set(true);
    try {
      const baseUrl = d.kind === 'MOCK' ? '' : d.baseUrl.trim();
      const apiKey = d.kind === 'MOCK' ? '' : d.apiKey;
      if (!d.id) {
        await this.api.createLlmConnection({
          name: d.name.trim(),
          kind: d.kind,
          enabled: d.enabled,
          ...(baseUrl ? { baseUrl } : {}),
          ...(apiKey ? { apiKey } : {}),
        });
        this.toast.success('Conexión creada');
      } else {
        const o = d.original;
        const patch: LlmConnectionUpdateInput = { name: d.name.trim(), kind: d.kind, enabled: d.enabled };
        if (baseUrl) patch.baseUrl = baseUrl;
        else if (o?.baseUrl) patch.baseUrl = null; // se borró la URL base
        if (apiKey) patch.apiKey = apiKey; // la API key solo se envía si se escribió una nueva
        await this.api.updateLlmConnection(d.id, patch);
        this.toast.success('Conexión actualizada');
      }
      this.conn.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.savingConn.set(false);
    }
  }

  async toggleConnection(c: LlmConnection) {
    try {
      await this.api.updateLlmConnection(c.id, { enabled: !c.enabled });
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async testConnection(c: LlmConnection) {
    this.testing.set(c.id);
    try {
      const r = await this.api.testLlmConnection(c.id);
      this.testResults.update((m) => ({ ...m, [c.id]: r }));
    } catch (e) {
      this.testResults.update((m) => ({ ...m, [c.id]: { ok: false, message: errorMessage(e) } }));
    } finally {
      this.testing.set(null);
    }
  }

  async deleteConnection(c: LlmConnection) {
    if (!confirm(`¿Eliminar la conexión "${c.name}" y sus modelos? No se puede eliminar si hay agentes usándola.`)) return;
    try {
      await this.api.deleteLlmConnection(c.id);
      this.toast.success('Conexión eliminada');
      if (this.conn()?.id === c.id) this.conn.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  // ----- Modelos -----

  newModel(connectionId: string) {
    this.model.set({
      connectionId,
      id: null,
      modelId: '',
      label: '',
      tier: 'STANDARD',
      inputUsdPerMTok: null,
      outputUsdPerMTok: null,
      cacheReadUsdPerMTok: null,
      enabled: true,
    });
  }

  editModel(m: LlmModel) {
    this.model.set({ ...m });
  }

  isEditingModel(connectionId: string, id: string | null) {
    const d = this.model();
    return !!d && d.connectionId === connectionId && d.id === id;
  }

  modelInvalid(d: ModelDraft) {
    const price = (v: number | null) => v === null || v === undefined || Number.isNaN(v) || v < 0;
    const cache = d.cacheReadUsdPerMTok;
    return (
      !d.modelId.trim() ||
      !d.label.trim() ||
      price(d.inputUsdPerMTok) ||
      price(d.outputUsdPerMTok) ||
      (cache !== null && cache !== undefined && (Number.isNaN(cache) || cache < 0))
    );
  }

  async saveModel() {
    const d = this.model();
    if (!d || this.modelInvalid(d)) return;
    this.savingModel.set(true);
    const cache = d.cacheReadUsdPerMTok;
    const data: LlmModelInput = {
      modelId: d.modelId.trim(),
      label: d.label.trim(),
      tier: d.tier,
      inputUsdPerMTok: Number(d.inputUsdPerMTok),
      outputUsdPerMTok: Number(d.outputUsdPerMTok),
      enabled: d.enabled,
      ...(cache !== null && cache !== undefined ? { cacheReadUsdPerMTok: Number(cache) } : {}),
    };
    try {
      if (d.id) await this.api.updateLlmModel(d.id, data);
      else await this.api.createLlmModel(d.connectionId, data);
      this.toast.success(d.id ? 'Modelo actualizado' : 'Modelo agregado');
      this.model.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.savingModel.set(false);
    }
  }

  async deleteModel(m: LlmModel) {
    if (!confirm(`¿Eliminar el modelo "${m.label}"?`)) return;
    try {
      await this.api.deleteLlmModel(m.id);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  tierClass(tier: ModelTier) {
    return tier === 'PREMIUM' ? 'primary' : tier === 'ECONOMY' ? 'success' : 'info';
  }
}
