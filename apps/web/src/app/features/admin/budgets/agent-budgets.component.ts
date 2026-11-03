import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../../core/api.service';
import type { Agent, AgentBudgetInput, AgentBudgetRow, BudgetPeriod, BudgetPolicy, ProviderInfo } from '../../../core/models';
import { ToastService } from '../../../core/toast.service';
import { budgetLevel, PERIOD_LABELS, POLICY_HELP, POLICY_LABELS } from '../../../shared/budget';
import { IconComponent } from '../../../shared/icon.component';
import { ProgressBarComponent } from '../../../shared/progress-bar.component';
import { NumberPipe, UsdPipe } from '../../../shared/usd.pipe';

interface AgentDraft {
  agentId: string;
  agentName: string;
  exists: boolean;
  period: BudgetPeriod;
  limitUsd: number | null;
  policy: BudgetPolicy;
  thresholds: string;
  downgradeProviderId: string;
  downgradeModel: string;
  critico: boolean;
}

const DEFAULT_THRESHOLDS = [80, 90, 100];

/**
 * Bolsas de presupuesto por agente (P0.1 nivel agente). Un agente con bolsa descuenta primero de la suya y luego de
 * la cadena de su unidad. Mismos controles que la bolsa de unidad (periodo, política, umbrales, criticidad).
 */
@Component({
  selector: 'nx-agent-budgets',
  imports: [FormsModule, IconComponent, ProgressBarComponent, UsdPipe, NumberPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card stack" style="margin-top:16px">
      <div class="card-title">
        <div class="icon-tile"><nx-icon name="bot" /></div>
        <div>
          <h2>Bolsas por agente</h2>
          <p class="muted small" style="margin:0">Límite de gasto propio de un agente, además del de su unidad</p>
        </div>
        <span class="spacer"></span>
        @if (canEdit() && !draft() && addableAgents().length) {
          <button class="btn primary sm" (click)="open()"><nx-icon name="plus" [size]="14" />Añadir</button>
        }
      </div>

      @if (draft(); as d) {
        <div class="stack" style="gap:12px">
          @if (!d.exists) {
            <div class="field"><label for="ab-agent">Agente</label>
              <select id="ab-agent" class="input" [(ngModel)]="d.agentId">
                <option value="">— Seleccione —</option>
                @for (a of addableAgents(); track a.id) { <option [value]="a.id">{{ a.name }}</option> }
              </select></div>
          } @else { <p class="muted small" style="margin:0">{{ d.agentName }}</p> }

          <div class="grid grid-3">
            <div class="field"><label for="ab-period">Periodo</label>
              <select id="ab-period" class="input" [(ngModel)]="d.period">
                @for (p of periods; track p) { <option [value]="p">{{ periodLabels[p] }}</option> }
              </select></div>
            <div class="field"><label for="ab-limit">Límite (USD)</label>
              <input id="ab-limit" class="input" type="number" min="0.01" step="0.01" [(ngModel)]="d.limitUsd" placeholder="Ej. 100" /></div>
            <div class="field"><label for="ab-thr">Umbrales (%)</label>
              <input id="ab-thr" class="input" [(ngModel)]="d.thresholds" placeholder="80, 90, 100" [class.invalid]="parseThresholds(d.thresholds) === null" /></div>
          </div>

          <div class="field">
            <label id="ab-policy">Política al agotarse</label>
            <div class="grid grid-3" role="radiogroup" aria-labelledby="ab-policy">
              @for (p of policies; track p) {
                <label class="choice"><input type="radio" name="ab-policy" [value]="p" [(ngModel)]="d.policy" />
                  <span><strong>{{ policyLabels[p] }}</strong><span class="muted small" style="display:block">{{ policyHelp[p] }}</span></span></label>
              }
            </div>
          </div>

          @if (d.policy === 'DOWNGRADE') {
            <div class="grid grid-2">
              <div class="field"><label for="ab-dprov">Proveedor de degradación</label>
                <select id="ab-dprov" class="input" [ngModel]="d.downgradeProviderId" (ngModelChange)="onDowngradeProvider(d, $event)">
                  <option value="">— Seleccione —</option>
                  @for (p of catalog(); track p.id) { <option [value]="p.id" [disabled]="!p.configured">{{ p.label }}</option> }
                </select></div>
              <div class="field"><label for="ab-dmodel">Modelo económico</label>
                <select id="ab-dmodel" class="input" [(ngModel)]="d.downgradeModel" [disabled]="!d.downgradeProviderId">
                  @for (m of modelsFor(d.downgradeProviderId); track m.id) { <option [value]="m.id">{{ m.label }}</option> }
                </select></div>
            </div>
          }

          <label class="choice" style="max-width:none"><input type="checkbox" name="ab-critico" [(ngModel)]="d.critico" />
            <span><strong>Proceso crítico</strong><span class="muted small" style="display:block">Un crítico bloquea al tope y no degrada.</span></span></label>

          <div class="row"><span class="spacer"></span>
            <button class="btn" (click)="draft.set(null)">Cancelar</button>
            <button class="btn primary" [disabled]="saving() || invalid(d)" (click)="save()"><nx-icon name="save" />{{ saving() ? 'Guardando…' : 'Guardar' }}</button>
          </div>
        </div>
      }

      @if (loading()) {
        <p class="muted small">Cargando bolsas…</p>
      } @else if (error()) {
        <div class="callout warning" role="alert"><nx-icon name="alert" [size]="16" /><span>{{ error() }}</span>
          <button class="btn sm" (click)="load()">Reintentar</button></div>
      } @else if (!rows().length) {
        <p class="muted small">Ningún agente tiene bolsa propia. Use «Añadir» para asignar una.</p>
      } @else {
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Agente</th><th style="min-width:200px">Consumo</th><th>Periodo</th><th>Política</th><th></th></tr></thead>
            <tbody>
              @for (r of rows(); track r.agentId) {
                <tr>
                  <td><strong>{{ r.agentName }}</strong>@if (r.critico) { <span class="badge danger" style="margin-left:6px">Crítico</span> }</td>
                  <td>
                    <nx-progress [pct]="r.pct" [label]="'Consumo de ' + r.agentName" />
                    <div class="row small" style="margin-top:4px; gap:6px">
                      <span><strong>{{ r.spentUsd | usd }}</strong><span class="muted">&nbsp;de {{ r.limitUsd | usd }}</span></span>
                      <span class="spacer"></span><span class="pct {{ level(r.pct) }}">{{ r.pct | num: 1 }} %</span>
                    </div>
                  </td>
                  <td class="nowrap">{{ periodLabels[r.period] }}<div class="mono small muted">{{ r.periodKey }}</div></td>
                  <td><span class="badge" [class.danger]="r.policy === 'BLOCK'" [class.warning]="r.policy === 'DOWNGRADE'" [class.info]="r.policy === 'ALERT_ONLY'">{{ policyLabels[r.policy] }}</span></td>
                  <td class="num nowrap">
                    @if (canEdit()) {
                      <button class="btn sm" (click)="edit(r)"><nx-icon name="pencil" [size]="14" />Editar</button>
                      <button class="btn ghost icon sm danger" title="Quitar bolsa" aria-label="Quitar bolsa" (click)="remove(r)"><nx-icon name="trash" [size]="14" /></button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class AgentBudgetsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly canEdit = input(false);

  readonly periods: BudgetPeriod[] = ['MONTHLY', 'QUARTERLY', 'YEARLY'];
  readonly policies: BudgetPolicy[] = ['BLOCK', 'DOWNGRADE', 'ALERT_ONLY'];
  readonly periodLabels = PERIOD_LABELS;
  readonly policyLabels = POLICY_LABELS;
  readonly policyHelp = POLICY_HELP;
  readonly level = budgetLevel;

  readonly rows = signal<AgentBudgetRow[]>([]);
  readonly allAgents = signal<Agent[]>([]);
  readonly catalog = signal<ProviderInfo[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly draft = signal<AgentDraft | null>(null);

  /** Agentes que todavía no tienen bolsa (candidatos a añadir). */
  readonly addableAgents = computed(() => {
    const withBag = new Set(this.rows().map((r) => r.agentId));
    return this.allAgents().filter((a) => !withBag.has(a.id));
  });

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [rows, agents, catalog] = await Promise.all([
        this.api.agentBudgets(),
        this.api.agents().catch(() => []),
        this.api.llmCatalog().catch(() => []),
      ]);
      this.rows.set(rows);
      this.allAgents.set(agents);
      this.catalog.set(catalog);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  open() {
    this.draft.set({
      agentId: '',
      agentName: '',
      exists: false,
      period: 'MONTHLY',
      limitUsd: null,
      policy: 'BLOCK',
      thresholds: DEFAULT_THRESHOLDS.join(', '),
      downgradeProviderId: '',
      downgradeModel: '',
      critico: true,
    });
  }

  edit(r: AgentBudgetRow) {
    this.draft.set({
      agentId: r.agentId,
      agentName: r.agentName,
      exists: true,
      period: r.period,
      limitUsd: r.limitUsd,
      policy: r.policy,
      thresholds: (r.alertThresholds?.length ? r.alertThresholds : DEFAULT_THRESHOLDS).join(', '),
      downgradeProviderId: r.downgradeProviderId ?? '',
      downgradeModel: r.downgradeModel ?? '',
      critico: r.critico,
    });
  }

  modelsFor(providerId: string) {
    return this.catalog().find((p) => p.id === providerId)?.models ?? [];
  }

  onDowngradeProvider(d: AgentDraft, providerId: string) {
    d.downgradeProviderId = providerId;
    const models = this.modelsFor(providerId);
    d.downgradeModel = (models.find((m) => m.tier === 'ECONOMY') ?? models[0])?.id ?? '';
  }

  parseThresholds(text: string): number[] | null {
    const parts = text.split(/[,;\s]+/).filter(Boolean);
    const nums = parts.map(Number);
    if (nums.some((n) => !Number.isFinite(n) || n <= 0 || n > 1000)) return null;
    return [...new Set(nums.map((n) => Math.round(n)))].sort((a, b) => a - b);
  }

  invalid(d: AgentDraft) {
    return !d.agentId || !d.limitUsd || d.limitUsd <= 0 || this.parseThresholds(d.thresholds) === null;
  }

  async save() {
    const d = this.draft();
    if (!d || this.invalid(d)) return;
    const body: AgentBudgetInput = {
      period: d.period,
      limitUsd: Number(d.limitUsd),
      policy: d.policy,
      alertThresholds: this.parseThresholds(d.thresholds) ?? DEFAULT_THRESHOLDS,
      critico: d.critico,
      ...(d.policy === 'DOWNGRADE' && d.downgradeProviderId && d.downgradeModel
        ? { downgradeProviderId: d.downgradeProviderId, downgradeModel: d.downgradeModel }
        : {}),
    };
    this.saving.set(true);
    try {
      await this.api.setAgentBudget(d.agentId, body);
      this.toast.success('Bolsa del agente guardada');
      this.draft.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  async remove(r: AgentBudgetRow) {
    if (!confirm(`¿Quitar la bolsa de "${r.agentName}"? El agente quedará solo con los límites de su unidad.`)) return;
    try {
      await this.api.deleteAgentBudget(r.agentId);
      this.toast.success('Bolsa quitada');
      if (this.draft()?.agentId === r.agentId) this.draft.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
