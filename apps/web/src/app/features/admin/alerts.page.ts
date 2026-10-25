import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import type { BudgetAlert } from '../../core/models';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { UsdPipe } from '../../shared/usd.pipe';

@Component({
  selector: 'nx-admin-alerts',
  imports: [
    RouterLink,
    IconComponent,
    RelativeTimePipe,
    UsdPipe,
    EmptyStateComponent,
    ErrorStateComponent,
    LoadingStateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div><h1>Alertas</h1><p>Umbrales de presupuesto cruzados por las unidades (últimas 100)</p></div>
        <button class="btn" (click)="load()" [disabled]="loading()"><nx-icon name="refresh" [size]="15" />Actualizar</button>
      </div>

      <div class="card" style="padding:0">
        @if (loading()) {
          <nx-loading-state text="Cargando alertas…" />
        } @else if (error()) {
          <nx-error-state title="No se pudieron cargar las alertas" message="{{ error() }}" (retry)="load()" />
        } @else if (alerts().length) {
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Unidad</th><th>Periodo</th><th class="num">Umbral</th><th class="num">Gastado</th><th class="num">Límite</th><th>Fecha</th></tr></thead>
              <tbody>
                @for (a of alerts(); track a.id) {
                  <tr>
                    <td><strong>{{ a.orgUnitName }}</strong></td>
                    <td class="mono small">{{ a.periodKey }}</td>
                    <td class="num"><span class="badge {{ cls(a.threshold) }}"><nx-icon name="bell" [size]="12" />{{ a.threshold }} %</span></td>
                    <td class="num">{{ a.spentUsd | usd }}</td>
                    <td class="num">{{ a.limitUsd | usd }}</td>
                    <td class="muted small nowrap" [title]="a.createdAt">{{ a.createdAt | ago }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <nx-empty-state icon="bell" title="Sin alertas">
            <p>Ninguna unidad ha cruzado sus umbrales. Configure umbrales en <a routerLink="/admin/budgets">Presupuestos</a>.</p>
          </nx-empty-state>
        }
      </div>
    </div>
  `,
})
export class AlertsPage implements OnInit {
  private readonly api = inject(ApiService);
  readonly alerts = signal<BudgetAlert[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.alerts.set(await this.api.alerts());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  cls(threshold: number) {
    return threshold >= 100 ? 'danger' : threshold >= 80 ? 'warning' : 'info';
  }
}
