import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../core/api.service';
import type { BudgetInput, BudgetPeriod, BudgetPolicy, BudgetRow, ProviderInfo } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { budgetLevel, PERIOD_LABELS, POLICY_HELP, POLICY_LABELS, TIER_LABELS, treeOrder } from '../../shared/budget';
import { IconComponent } from '../../shared/icon.component';
import { ProgressBarComponent } from '../../shared/progress-bar.component';
import { NumberPipe, UsdPipe } from '../../shared/usd.pipe';

interface BudgetDraft {
  orgUnitId: string;
  orgUnitName: string;
  exists: boolean;
  period: BudgetPeriod;
  limitUsd: number | null;
  policy: BudgetPolicy;
  thresholds: string;
  downgradeProviderId: string;
  downgradeModel: string;
}

const DEFAULT_THRESHOLDS = [50, 80, 100];

@Component({
  selector: 'nx-admin-budgets',
  imports: [FormsModule, IconComponent, ProgressBarComponent, UsdPipe, NumberPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './budgets.page.html',
})
export class BudgetsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly periods: BudgetPeriod[] = ['MONTHLY', 'QUARTERLY', 'YEARLY'];
  readonly policies: BudgetPolicy[] = ['BLOCK', 'DOWNGRADE', 'ALERT_ONLY'];
  readonly periodLabels = PERIOD_LABELS;
  readonly policyLabels = POLICY_LABELS;
  readonly policyHelp = POLICY_HELP;
  readonly tierLabels = TIER_LABELS;
  readonly level = budgetLevel;

  readonly rows = signal<BudgetRow[]>([]);
  readonly catalog = signal<ProviderInfo[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly draft = signal<BudgetDraft | null>(null);
  readonly saving = signal(false);

  readonly tree = computed(() => treeOrder(this.rows(), (r) => r.orgUnitId, (r) => r.parentId));
  readonly configured = computed(() => this.rows().filter((r) => r.budget).length);
  readonly atRisk = computed(() => this.rows().filter((r) => (r.pct ?? 0) >= 80).length);

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [rows, catalog] = await Promise.all([this.api.budgets(), this.api.llmCatalog().catch(() => [])]);
      this.rows.set(rows);
      this.catalog.set(catalog);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  edit(r: BudgetRow) {
    const b = r.budget;
    this.draft.set({
      orgUnitId: r.orgUnitId,
      orgUnitName: r.orgUnitName,
      exists: !!b,
      period: b?.period ?? 'MONTHLY',
      limitUsd: b?.limitUsd ?? null,
      policy: b?.policy ?? 'BLOCK',
      thresholds: (b?.alertThresholds?.length ? b.alertThresholds : DEFAULT_THRESHOLDS).join(', '),
      downgradeProviderId: b?.downgradeProviderId ?? '',
      downgradeModel: b?.downgradeModel ?? '',
    });
  }

  modelsFor(providerId: string) {
    return this.catalog().find((p) => p.id === providerId)?.models ?? [];
  }

  onDowngradeProvider(d: BudgetDraft, providerId: string) {
    d.downgradeProviderId = providerId;
    const models = this.modelsFor(providerId);
    d.downgradeModel = (models.find((m) => m.tier === 'ECONOMY') ?? models[0])?.id ?? '';
  }

  /** Umbrales válidos (1–1000), únicos y ordenados; `null` si el texto tiene valores inválidos. */
  parseThresholds(text: string): number[] | null {
    const parts = text.split(/[,;\s]+/).filter(Boolean);
    const nums = parts.map(Number);
    if (nums.some((n) => !Number.isFinite(n) || n <= 0 || n > 1000)) return null;
    return [...new Set(nums.map((n) => Math.round(n)))].sort((a, b) => a - b);
  }

  invalid(d: BudgetDraft) {
    return !d.limitUsd || d.limitUsd <= 0 || this.parseThresholds(d.thresholds) === null;
  }

  async save() {
    const d = this.draft();
    if (!d || this.invalid(d)) return;
    const body: BudgetInput = {
      period: d.period,
      limitUsd: Number(d.limitUsd),
      policy: d.policy,
      alertThresholds: this.parseThresholds(d.thresholds) ?? DEFAULT_THRESHOLDS,
      ...(d.policy === 'DOWNGRADE' && d.downgradeProviderId && d.downgradeModel
        ? { downgradeProviderId: d.downgradeProviderId, downgradeModel: d.downgradeModel }
        : {}),
    };
    this.saving.set(true);
    try {
      await this.api.setBudget(d.orgUnitId, body);
      this.toast.success(`Presupuesto de ${d.orgUnitName} guardado`);
      this.draft.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  async remove(r: BudgetRow) {
    if (!confirm(`¿Quitar el presupuesto de "${r.orgUnitName}"? La unidad quedará sin límite propio (siguen aplicando los de sus unidades superiores).`)) return;
    try {
      await this.api.deleteBudget(r.orgUnitId);
      this.toast.success('Presupuesto quitado');
      if (this.draft()?.orgUnitId === r.orgUnitId) this.draft.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  providerLabel(id: string | null) {
    return (id && this.catalog().find((p) => p.id === id)?.label) || id || '';
  }
}
