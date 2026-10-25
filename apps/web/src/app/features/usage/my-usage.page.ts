import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ApiService, errorMessage } from '../../core/api.service';
import type { MyUsage } from '../../core/models';
import { budgetLevel, periodLabel, POLICY_HELP, POLICY_LABELS } from '../../shared/budget';
import { IconComponent } from '../../shared/icon.component';
import { ProgressBarComponent } from '../../shared/progress-bar.component';
import { NumberPipe, UsdPipe } from '../../shared/usd.pipe';
import { PageHeaderComponent } from '../../layout/page-header.component';

@Component({
  selector: 'nx-my-usage',
  imports: [IconComponent, ProgressBarComponent, UsdPipe, NumberPipe, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nx-page-header heading="Mi consumo" description="Su uso de modelos de IA y los presupuestos que lo cubren">
        <button actions class="btn" (click)="load()" [disabled]="loading()"><nx-icon name="refresh" [size]="15" />Actualizar</button>
      </nx-page-header>

      @if (loading()) {
        <div class="card empty"><p>Cargando consumo…</p></div>
      } @else if (error()) {
        <div class="card empty">
          <nx-icon name="alert" [size]="28" /><h3>No se pudo cargar su consumo</h3><p>{{ error() }}</p>
          <button class="btn" (click)="load()">Reintentar</button>
        </div>
      } @else if (data(); as d) {
        <div class="kpis">
          <div class="card kpi-card">
            <div class="icon-tile"><nx-icon name="wallet" /></div>
            <div><div class="muted small">Mi costo este mes</div><div class="kpi-value">{{ d.me.costUsd | usd }}</div></div>
          </div>
          <div class="card kpi-card">
            <div class="icon-tile"><nx-icon name="zap" /></div>
            <div><div class="muted small">Llamadas al modelo</div><div class="kpi-value">{{ d.me.calls | num }}</div></div>
          </div>
          <div class="card kpi-card">
            <div class="icon-tile"><nx-icon name="cpu" /></div>
            <div>
              <div class="muted small">Tokens entrada / salida</div>
              <div class="kpi-value">{{ d.me.inputTokens | num }} <span class="muted">/</span> {{ d.me.outputTokens | num }}</div>
            </div>
          </div>
        </div>
        <p class="muted small">Desde {{ since(d.me.since) }} · Unidad: <strong>{{ d.orgUnit.name }}</strong></p>

        <div class="section-title"><h2>Presupuestos que me aplican</h2></div>
        <p class="muted small" style="margin-top:-6px">
          Su consumo descuenta de su unidad y de todas las unidades superiores. Debe haber saldo en toda la cadena.
        </p>
        @if (d.budgets.length) {
          <div class="stack">
            @for (b of d.budgets; track b.orgUnitId; let first = $first) {
              <div class="card stack">
                <div class="row wrap">
                  <nx-icon name="building" [size]="16" />
                  <strong>{{ b.orgUnitName }}</strong>
                  @if (first && b.orgUnitId === d.orgUnit.id) { <span class="badge primary">Mi unidad</span> }
                  <span class="spacer"></span>
                  <span class="badge" [title]="policyHelp[b.policy]">{{ policyLabels[b.policy] }}</span>
                  <span class="badge">{{ periodLabel(b.period) }} · {{ b.periodKey }}</span>
                </div>
                <nx-progress [pct]="b.pct" [label]="'Consumo de ' + b.orgUnitName" />
                <div class="row wrap small">
                  <span><strong>{{ b.spentUsd | usd }}</strong><span class="muted">&nbsp;de {{ b.limitUsd | usd }}</span></span>
                  <span class="spacer"></span>
                  <span class="pct {{ level(b.pct) }}">{{ b.pct | num: 1 }} %</span>
                </div>
                @if (b.pct >= 100) {
                  <div class="callout danger"><nx-icon name="alert" [size]="16" />
                    @switch (b.policy) {
                      @case ('BLOCK') { Presupuesto agotado: las nuevas llamadas al modelo se rechazan hasta el siguiente periodo. }
                      @case ('DOWNGRADE') { Presupuesto agotado: se usará un modelo más económico. }
                      @default { Presupuesto agotado (solo alerta, no se bloquea). }
                    }
                  </div>
                }
              </div>
            }
          </div>
        } @else {
          <div class="card empty"><nx-icon name="wallet" [size]="28" /><h3>Sin presupuestos definidos</h3>
            <p>Ni su unidad ni sus unidades superiores tienen un presupuesto configurado.</p></div>
        }
        <p class="muted small" style="margin-top:16px">Costos estimados según los precios configurados; la factura del proveedor prevalece.</p>
      }
    </div>
  `,
})
export class MyUsagePage implements OnInit {
  private readonly api = inject(ApiService);
  readonly data = signal<MyUsage | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly policyLabels = POLICY_LABELS;
  readonly policyHelp = POLICY_HELP;
  readonly periodLabel = periodLabel;
  readonly level = budgetLevel;

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.data.set(await this.api.myUsage());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  since(iso: string) {
    return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
  }
}
