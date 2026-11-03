import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../../core/api.service';
import type { AgentBudgetRow, BudgetOverride, BudgetOverrideInput, BudgetRow } from '../../../core/models';
import { ToastService } from '../../../core/toast.service';
import { IconComponent } from '../../../shared/icon.component';
import { RelativeTimePipe } from '../../../shared/relative-time.pipe';
import { UsdPipe } from '../../../shared/usd.pipe';

type Scope = 'unit' | 'agent';

interface OverrideDraft {
  scope: Scope;
  orgUnitId: string;
  agentId: string;
  motivo: string;
  expiresAt: string;
  limitExtraUsd: number | null;
}

/**
 * Autorizaciones expresas de gasto por encima del tope (override gobernado, P0.1). No es un bypass permanente: la
 * concede un ADMIN/OWNER, con motivo auditado, vigencia acotada y alcance a una unidad O un agente. Se puede revocar.
 */
@Component({
  selector: 'nx-budget-overrides',
  imports: [FormsModule, IconComponent, RelativeTimePipe, UsdPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card stack" style="margin-top:16px">
      <div class="card-title">
        <div class="icon-tile"><nx-icon name="key" /></div>
        <div>
          <h2>Autorizaciones de gasto (override)</h2>
          <p class="muted small" style="margin:0">Permiten gastar por encima del tope, con motivo y vigencia</p>
        </div>
        <span class="spacer"></span>
        @if (canEdit() && !draft()) {
          <button class="btn primary sm" (click)="open()" [disabled]="loading()"><nx-icon name="plus" [size]="14" />Conceder</button>
        }
      </div>

      @if (draft(); as d) {
        <div class="stack" style="gap:12px">
          <div class="field">
            <label id="ov-scope">Alcance</label>
            <div class="row" role="radiogroup" aria-labelledby="ov-scope" style="gap:16px">
              <label class="choice"><input type="radio" name="ov-scope" value="unit" [(ngModel)]="d.scope" /><span>Unidad</span></label>
              <label class="choice"><input type="radio" name="ov-scope" value="agent" [(ngModel)]="d.scope" /><span>Agente</span></label>
            </div>
          </div>
          <div class="grid grid-2">
            @if (d.scope === 'unit') {
              <div class="field"><label for="ov-unit">Unidad</label>
                <select id="ov-unit" class="input" [(ngModel)]="d.orgUnitId">
                  <option value="">— Seleccione —</option>
                  @for (u of unitsWithBudget(); track u.orgUnitId) { <option [value]="u.orgUnitId">{{ u.orgUnitName }}</option> }
                </select>
                @if (!unitsWithBudget().length) { <span class="hint">Ninguna unidad tiene presupuesto que autorizar.</span> }
              </div>
            } @else {
              <div class="field"><label for="ov-agent">Agente</label>
                <select id="ov-agent" class="input" [(ngModel)]="d.agentId">
                  <option value="">— Seleccione —</option>
                  @for (a of agents(); track a.agentId) { <option [value]="a.agentId">{{ a.agentName }}</option> }
                </select>
                @if (!agents().length) { <span class="hint">Ningún agente tiene bolsa de presupuesto que autorizar.</span> }
              </div>
            }
            <div class="field"><label for="ov-exp">Vigente hasta</label>
              <input id="ov-exp" class="input" type="datetime-local" [(ngModel)]="d.expiresAt" /></div>
          </div>
          <div class="field"><label for="ov-motivo">Motivo</label>
            <input id="ov-motivo" class="input" [(ngModel)]="d.motivo" maxlength="500" placeholder="Por qué se autoriza el gasto adicional" /></div>
          <div class="field" style="max-width:260px"><label for="ov-extra">Tope adicional (USD, opcional)</label>
            <input id="ov-extra" class="input" type="number" min="0" step="0.01" [(ngModel)]="d.limitExtraUsd" placeholder="Sin tope extra" /></div>
          <div class="row"><span class="spacer"></span>
            <button class="btn" (click)="draft.set(null)">Cancelar</button>
            <button class="btn primary" [disabled]="saving() || invalid(d)" (click)="grant()"><nx-icon name="check" />{{ saving() ? 'Concediendo…' : 'Conceder' }}</button>
          </div>
        </div>
      }

      @if (loading()) {
        <p class="muted small">Cargando autorizaciones…</p>
      } @else if (error()) {
        <div class="callout warning" role="alert"><nx-icon name="alert" [size]="16" /><span>{{ error() }}</span>
          <button class="btn sm" (click)="load()">Reintentar</button></div>
      } @else if (!overrides().length) {
        <p class="muted small">No hay autorizaciones registradas.</p>
      } @else {
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Alcance</th><th>Motivo</th><th>Vigencia</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              @for (o of overrides(); track o.id) {
                <tr>
                  <td class="nowrap">{{ targetLabel(o) }}<div class="mono small muted">{{ o.periodKey }}</div></td>
                  <td>{{ o.motivo }}@if (o.limitExtraUsd !== null) { <div class="muted small">+{{ o.limitExtraUsd | usd }}</div> }</td>
                  <td class="nowrap small">{{ o.expiresAt | ago }}</td>
                  <td>
                    @if (o.revokedAt) { <span class="badge">Revocada</span> }
                    @else if (o.vigente) { <span class="badge info">Vigente</span> }
                    @else { <span class="badge warning">Vencida</span> }
                  </td>
                  <td class="num nowrap">
                    @if (canEdit() && o.vigente && !o.revokedAt) {
                      <button class="btn ghost icon sm danger" title="Revocar" aria-label="Revocar autorización" (click)="revoke(o)"><nx-icon name="xCircle" [size]="14" /></button>
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
export class BudgetOverridesComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly canEdit = input(false);
  /** Unidades con su presupuesto (para el selector de alcance de unidad). */
  readonly units = input<BudgetRow[]>([]);

  readonly overrides = signal<BudgetOverride[]>([]);
  readonly agents = signal<AgentBudgetRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly draft = signal<OverrideDraft | null>(null);

  unitsWithBudget() {
    return this.units().filter((u) => u.budget);
  }

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [overrides, agents] = await Promise.all([this.api.budgetOverrides(), this.api.agentBudgets().catch(() => [])]);
      this.overrides.set(overrides);
      this.agents.set(agents);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  open() {
    this.draft.set({ scope: 'unit', orgUnitId: '', agentId: '', motivo: '', expiresAt: '', limitExtraUsd: null });
  }

  invalid(d: OverrideDraft) {
    if (d.motivo.trim().length < 3 || !d.expiresAt) return true;
    if (new Date(d.expiresAt).getTime() <= Date.now()) return true;
    return d.scope === 'unit' ? !d.orgUnitId : !d.agentId;
  }

  targetLabel(o: BudgetOverride) {
    if (o.orgUnitId) return this.units().find((u) => u.orgUnitId === o.orgUnitId)?.orgUnitName ?? 'Unidad';
    return this.agents().find((a) => a.agentId === o.agentId)?.agentName ?? 'Agente';
  }

  async grant() {
    const d = this.draft();
    if (!d || this.invalid(d)) return;
    const body: BudgetOverrideInput = {
      motivo: d.motivo.trim(),
      expiresAt: new Date(d.expiresAt).toISOString(),
      ...(d.scope === 'unit' ? { orgUnitId: d.orgUnitId } : { agentId: d.agentId }),
      ...(d.limitExtraUsd != null && d.limitExtraUsd >= 0 ? { limitExtraUsd: Number(d.limitExtraUsd) } : {}),
    };
    this.saving.set(true);
    try {
      await this.api.grantBudgetOverride(body);
      this.toast.success('Autorización concedida');
      this.draft.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  async revoke(o: BudgetOverride) {
    if (!confirm('¿Revocar esta autorización de gasto? El tope volverá a aplicarse de inmediato.')) return;
    try {
      await this.api.revokeBudgetOverride(o.id);
      this.toast.success('Autorización revocada');
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
