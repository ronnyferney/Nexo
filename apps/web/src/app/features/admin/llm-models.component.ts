import { ChangeDetectionStrategy, Component, computed, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../core/api.service';
import type { LlmModelMeta, ProviderView } from '../../core/llm-providers.models';
import type { LlmConnection, LlmModel, LlmModelInput, ModelTier, ProviderInfo } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { TIER_LABELS } from '../../shared/budget';
import { IconComponent } from '../../shared/icon.component';
import { UsdPipe } from '../../shared/usd.pipe';
import type { BrandLogo } from '../integrations/integration-logos';
import { BrandLogoComponent } from '../integrations/brand-logo.component';
import { providerLogo } from './ai-provider-logos';
import { formatContext, normalize, SPECIALTY_LABELS, specialtiesOf } from './provider-meta';

interface ModelRow {
  key: string;
  providerId: string;
  providerName: string;
  source: string;
  logo: BrandLogo;
  label: string;
  modelId: string;
  tier: ModelTier;
  input: number | null;
  output: number | null;
  enabled: boolean;
  /** Solo los modelos de conexiones del workspace se editan; los de plataforma y prueba son de solo lectura. */
  model: LlmModel | null;
  tag: 'PLATFORM' | 'TEST' | null;
  unpriced: boolean;
  /** «128 K de memoria · Código, Visión» (si el servidor o el catálogo lo informan). */
  meta: string | null;
}

function metaOf(modelId: string, ctx: number | null | undefined, given: readonly string[] | null | undefined) {
  const parts: string[] = [];
  const c = formatContext(ctx);
  if (c) parts.push(`${c} de memoria`);
  const sp = specialtiesOf(modelId, given).filter((s) => s !== 'GENERAL').map((s) => SPECIALTY_LABELS[s]);
  if (sp.length) parts.push(sp.join(', '));
  return parts.join(' · ') || null;
}

const MOCK = { id: 'mock', name: 'Simulado', logo: 'mock' };

/** Pestaña «Modelos de IA»: todos los modelos del workspace con tarifa, nivel y estado editables en línea. */
@Component({
  selector: 'nx-llm-models',
  imports: [FormsModule, IconComponent, BrandLogoComponent, UsdPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './llm-models.component.html',
  styleUrl: './llm-models.component.scss',
})
export class LlmModelsComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly connections = input.required<LlmConnection[]>();
  readonly providers = input.required<ProviderView[]>();
  readonly catalog = input.required<ProviderInfo[]>();
  /** Filtro por proveedor; la página lo fija al venir desde «Ir a Modelos de IA». */
  readonly providerFilter = model('');
  readonly modelUpdated = output<LlmModel>();
  readonly goProviders = output<void>();

  readonly tiers: ModelTier[] = ['PREMIUM', 'STANDARD', 'ECONOMY'];
  readonly tierLabels = TIER_LABELS;
  readonly query = signal('');
  readonly onlyUnpriced = signal(false);
  readonly saving = signal<ReadonlySet<string>>(new Set());
  readonly saved = signal<string | null>(null);

  readonly rows = computed<ModelRow[]>(() => {
    const byConn = new Map<string, ProviderView>();
    for (const p of this.providers()) for (const c of p.connected ?? []) byConn.set(c.connectionId, p);
    const anthropic = this.providers().find((p) => p.id === 'anthropic');
    const out: ModelRow[] = [];
    for (const c of this.connections()) {
      const test = c.kind === 'MOCK';
      const p = byConn.get(c.id) ?? (test ? MOCK : c.kind === 'ANTHROPIC' ? anthropic : undefined);
      const prov = p ?? { id: `conn:${c.id}`, name: c.name, logo: '' };
      const local = (p as ProviderView | undefined)?.category === 'LOCAL';
      const suggested = new Map(((p as ProviderView | undefined)?.suggestedModels ?? []).map((s) => [s.id, s]));
      for (const m of c.models as LlmModelMeta[]) {
        const sm = suggested.get(m.modelId);
        const input = m.inputUsdPerMTok ?? null;
        const output = m.outputUsdPerMTok ?? null;
        out.push({
          key: m.id,
          providerId: prov.id,
          providerName: prov.name,
          source: c.name,
          logo: providerLogo(prov),
          label: m.label,
          modelId: m.modelId,
          tier: m.tier,
          input,
          output,
          enabled: m.enabled,
          model: m,
          tag: test ? 'TEST' : null,
          unpriced: !test && (!!m.needsPricing || input === null || output === null || (!local && input === 0 && output === 0)),
          meta: test ? null : metaOf(m.modelId, m.contextTokens ?? sm?.contextTokens, m.specialties ?? sm?.specialties),
        });
      }
    }
    for (const s of this.catalog()) {
      const test = s.kind === 'MOCK';
      if (!s.system) continue; // las conexiones propias ya vienen completas de /admin/llm/connections
      const prov = test ? MOCK : s.kind === 'ANTHROPIC' ? (anthropic ?? { id: 'anthropic', name: 'Anthropic', logo: 'anthropic' }) : { id: s.id, name: s.label, logo: '' };
      for (const m of s.models) {
        out.push({
          key: `${s.id}:${m.id}`,
          providerId: prov.id,
          providerName: prov.name,
          source: test ? 'Simulado' : 'Incluido por Nexo',
          logo: providerLogo(prov),
          label: m.label,
          modelId: m.id,
          tier: m.tier,
          input: m.inputUsdPerMTok,
          output: m.outputUsdPerMTok,
          enabled: true,
          model: null,
          tag: test ? 'TEST' : 'PLATFORM',
          unpriced: false,
          meta: null,
        });
      }
    }
    return out;
  });

  readonly providerOptions = computed(() => {
    const seen = new Map<string, { id: string; name: string; count: number }>();
    for (const r of this.rows()) {
      const o = seen.get(r.providerId) ?? { id: r.providerId, name: r.providerName, count: 0 };
      o.count++;
      seen.set(r.providerId, o);
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  });

  readonly unpricedCount = computed(() => this.rows().filter((r) => r.unpriced).length);

  readonly filtered = computed(() => {
    const q = normalize(this.query().trim());
    const pf = this.providerFilter();
    return this.rows().filter(
      (r) =>
        (!pf || r.providerId === pf) &&
        (!this.onlyUnpriced() || r.unpriced) &&
        (!q || normalize(`${r.label} ${r.modelId} ${r.providerName} ${r.source}`).includes(q)),
    );
  });

  clearFilters() {
    this.query.set('');
    this.providerFilter.set('');
    this.onlyUnpriced.set(false);
  }

  async setPrice(r: ModelRow, field: 'inputUsdPerMTok' | 'outputUsdPerMTok', el: HTMLInputElement) {
    const raw = el.value.trim();
    const value = Number(raw);
    if (!raw || Number.isNaN(value) || value < 0) {
      el.value = r.model?.[field] == null ? '' : String(r.model[field]);
      this.toast.error('La tarifa debe ser un número mayor o igual a 0 (USD por millón de tokens).');
      return;
    }
    if (value === r.model?.[field]) return;
    if (!(await this.save(r, { [field]: value }))) el.value = r.model?.[field] == null ? '' : String(r.model[field]);
  }

  async setTier(r: ModelRow, el: HTMLSelectElement) {
    if (!(await this.save(r, { tier: el.value as ModelTier }))) el.value = r.tier;
  }

  async setEnabled(r: ModelRow, el: HTMLInputElement) {
    if (!(await this.save(r, { enabled: el.checked }))) el.checked = r.enabled;
  }

  /** Guarda un cambio en línea; `false` si falló (el control debe volver al valor guardado). */
  async save(r: ModelRow, patch: Partial<LlmModelInput>): Promise<boolean> {
    const m = r.model;
    if (!m) return false;
    this.saving.update((s) => new Set(s).add(m.id));
    try {
      const updated = await this.api.updateLlmModel(m.id, patch);
      this.modelUpdated.emit({ ...m, ...patch, ...updated });
      this.saved.set(m.id);
      setTimeout(() => this.saved() === m.id && this.saved.set(null), 2000);
      return true;
    } catch (e) {
      this.toast.error(errorMessage(e));
      return false;
    } finally {
      this.saving.update((s) => {
        const n = new Set(s);
        n.delete(m.id);
        return n;
      });
    }
  }

  tierClass(tier: ModelTier) {
    return tier === 'PREMIUM' ? 'primary' : tier === 'ECONOMY' ? 'success' : 'info';
  }
}
