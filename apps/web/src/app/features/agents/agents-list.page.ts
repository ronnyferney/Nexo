import { ChangeDetectionStrategy, Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AgentsScopeApi } from '../../core/agents-scope.api';
import type { AgentDashboard, DashboardAgent } from '../../core/agents-scope.models';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { HealthBadgeComponent, LaunchBadgeComponent, VisibilityBadgeComponent } from '../../shared/agent-badges.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { NumberPipe, UsdPipe } from '../../shared/usd.pipe';
import { PageHeaderComponent } from '../../layout/page-header.component';
import {
  type AgentFilter,
  buildStatusTabs,
  clampPage,
  distinctAreas,
  filterAgents,
  formatDeltaCount,
  formatDeltaPct,
  formatSuccessRate,
  pageCount,
  pageSlice,
  type StatusTab,
} from './agents-dashboard.util';

const PAGE_SIZE = 9;
type ViewMode = 'cards' | 'list';
type StatusFilter = '' | 'LAUNCHED' | 'DRAFT';

/**
 * Tablero del catálogo de agentes (RX-11): KPIs, pestañas por estado con contadores, búsqueda, filtros de área y
 * estado, vista de tarjetas o lista y paginación cliente sobre el arreglo de `GET /agents/dashboard`. Conserva el
 * acceso a Crear agente, Explorar y la navegación a cada agente (configurar / probar en el chat).
 */
@Component({
  selector: 'nx-agents-list',
  imports: [
    FormsModule,
    RouterLink,
    IconComponent,
    UsdPipe,
    NumberPipe,
    VisibilityBadgeComponent,
    LaunchBadgeComponent,
    HealthBadgeComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    LoadingStateComponent,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agents-list.page.html',
  styleUrl: './agents-list.page.scss',
})
export class AgentsListPage implements OnInit {
  private readonly api = inject(AgentsScopeApi);
  protected readonly auth = inject(AuthService);

  // Helpers puros usados en la plantilla.
  protected readonly deltaPct = formatDeltaPct;
  protected readonly deltaCount = formatDeltaCount;
  protected readonly successRate = formatSuccessRate;

  readonly data = signal<AgentDashboard | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly allowPersonalAgents = signal(false);

  readonly view = signal<ViewMode>('cards');
  readonly tab = signal<StatusTab>('all');
  readonly query = signal('');
  readonly area = signal<string | null>(null);
  readonly status = signal<StatusFilter>('');
  readonly page = signal(1);

  readonly agents = computed(() => this.data()?.agents ?? []);
  readonly tabs = computed(() => {
    const counts = this.data()?.counts;
    return counts ? buildStatusTabs(counts) : [];
  });
  readonly areas = computed(() => distinctAreas(this.agents()));

  private readonly activeFilter = computed<AgentFilter>(() => ({
    tab: this.tab(),
    query: this.query(),
    area: this.area(),
    status: this.status(),
  }));
  readonly filtered = computed(() => filterAgents(this.agents(), this.activeFilter()));
  readonly pageCount = computed(() => pageCount(this.filtered().length, PAGE_SIZE));
  readonly paged = computed(() => pageSlice(this.filtered(), this.page(), PAGE_SIZE));
  readonly hasFilters = computed(() => !!this.query().trim() || !!this.area() || !!this.status());

  /** EDITOR+ siempre; VIEWER solo si el workspace permite agentes personales (ADR 0007 D3). */
  readonly canCreate = computed(() => this.auth.canEdit() || this.allowPersonalAgents());

  constructor() {
    // Al cambiar los filtros o el conjunto, la página vuelve a un rango válido (sin quedar en una página vacía).
    effect(() => {
      const total = this.filtered().length;
      const clamped = clampPage(this.page(), total, PAGE_SIZE);
      if (clamped !== this.page()) this.page.set(clamped);
    });
  }

  ngOnInit() {
    void this.load();
    if (!this.auth.canEdit()) {
      this.api.workspaceSettings().then(
        (s) => this.allowPersonalAgents.set(!!s?.allowPersonalAgents),
        () => undefined,
      );
    }
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.data.set(await this.api.dashboard());
    } catch (e) {
      this.data.set(null);
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  selectTab(id: StatusTab) {
    this.tab.set(id);
    this.page.set(1);
  }

  onQuery(value: string) {
    this.query.set(value ?? '');
    this.page.set(1);
  }

  onArea(value: string) {
    this.area.set(value || null);
    this.page.set(1);
  }

  onStatus(value: StatusFilter) {
    this.status.set(value);
    this.page.set(1);
  }

  clearFilters() {
    this.query.set('');
    this.area.set(null);
    this.status.set('');
    this.page.set(1);
  }

  prevPage() {
    this.page.update((p) => Math.max(1, p - 1));
  }

  nextPage() {
    this.page.update((p) => Math.min(this.pageCount(), p + 1));
  }

  /** `trackBy` de la lista de agentes. */
  trackId(_: number, a: DashboardAgent) {
    return a.id;
  }
}
