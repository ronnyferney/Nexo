import { ChangeDetectionStrategy, Component, computed, effect, inject, input, OnInit, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AgentsScopeApi } from '../../core/agents-scope.api';
import { AccessApi } from '../../core/access.api';
import type { AgentHealthSummary } from '../../core/access.models';
import type { AgentScope, ScopedAgent } from '../../core/agents-scope.models';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { HealthBadgeComponent, LaunchBadgeComponent, VisibilityBadgeComponent } from '../../shared/agent-badges.component';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';

interface ScopeTab {
  id: AgentScope;
  label: string;
  empty: string;
}

const TABS: ScopeTab[] = [
  {
    id: 'available',
    label: 'Disponibles para mí',
    empty: 'Todavía no hay agentes para usted: cree uno o pida que le compartan uno (a usted, a su unidad o a su grupo).',
  },
  { id: 'mine', label: 'Mis agentes', empty: 'Aún no tiene agentes propios. Cree uno o duplique un agente desde Explorar.' },
  { id: 'shared', label: 'Compartidos conmigo', empty: 'Nadie ha compartido agentes con usted, sus unidades o sus grupos.' },
  { id: 'workspace', label: 'De la empresa', empty: 'La empresa todavía no tiene agentes publicados para todos.' },
];
const GOVERNANCE_TAB: ScopeTab = {
  id: 'all',
  label: 'Todos (gobierno)',
  empty: 'El workspace no tiene agentes.',
};

/** Lista de agentes por ámbito (ADR 0007): propios, compartidos, de la empresa y, para ADMIN/OWNER, todos. */
@Component({
  selector: 'nx-agents-list',
  imports: [FormsModule, RouterLink, IconComponent, RelativeTimePipe, VisibilityBadgeComponent, LaunchBadgeComponent, HealthBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div><h1>Agentes de IA</h1><p>Asistentes con instrucciones, modelo y herramientas conectadas a sus sistemas</p></div>
        <div class="row wrap">
          <a class="btn" routerLink="/agents/explore"><nx-icon name="search" />Explorar agentes</a>
          @if (canCreate()) {
            <a class="btn primary brand" routerLink="/agents/new"><nx-icon name="plus" />Crear agente</a>
          }
        </div>
      </div>

      <div class="tabs scroll" role="tablist" aria-label="Ámbito de los agentes">
        @for (t of tabs(); track t.id) {
          <button type="button" class="tab" role="tab" [class.active]="t.id === activeScope()" [attr.aria-selected]="t.id === activeScope()"
            (click)="select(t.id)">{{ t.label }}</button>
        }
      </div>

      @if (activeScope() === 'all') {
        <div class="callout info" style="margin-bottom:16px">
          <nx-icon name="shield" [size]="16" />
          <span>Vista de gobierno: ve la configuración, el costo y la salud de todos los agentes, pero no el contenido de las conversaciones ajenas.</span>
        </div>
      }

      @if (agents().length > 6 || query) {
        <div class="row" style="margin-bottom:16px">
          <input class="input" style="max-width:320px" type="search" placeholder="Buscar por nombre, descripción o dueño" aria-label="Buscar agentes"
            [(ngModel)]="query" (ngModelChange)="queryChanged($event)" />
        </div>
      }

      @if (error()) {
        <div class="card empty"><nx-icon name="alert" [size]="28" /><h3>No se pudieron cargar los agentes</h3><p>{{ error() }}</p>
          <button class="btn" (click)="reload()">Reintentar</button></div>
      } @else if (loading() && !agents().length) {
        <div class="card empty"><p>Cargando…</p></div>
      } @else if (filtered().length) {
        <div class="cards">
          @for (a of filtered(); track a.id) {
            <a class="card hover agent-card" [routerLink]="['/agents', a.id]" style="color:inherit">
              <div class="card-title"><div class="icon-tile"><nx-icon name="bot" /></div>
                <div style="min-width:0"><h3>{{ a.name }}</h3>
                  <div class="chips">
                    <nx-visibility-badge [visibility]="a.visibility" />
                    <nx-launch-badge [status]="a.launchStatus" />
                    @if (health().get(a.id); as h) { <nx-health-badge [score]="h.score" [level]="h.level" /> }
                  </div>
                </div></div>
              <p class="muted small">{{ a.description || (a.systemPrompt ? a.systemPrompt.slice(0, 110) + '…' : 'Sin instrucciones aún') }}</p>
              <div class="row small muted wrap">
                @if (a.owner) { <span><nx-icon name="user" [size]="13" /> {{ isMine(a) ? 'Usted' : a.owner.name }}</span> }
                <span class="badge primary">{{ a.model }}</span>
                <span class="spacer"></span><span>{{ a.updatedAt | ago }}</span>
              </div>
            </a>
          }
        </div>
      } @else if (query) {
        <div class="card empty"><nx-icon name="search" [size]="36" /><h3>Sin resultados</h3><p>Ningún agente coincide con «{{ query }}».</p></div>
      } @else {
        <div class="card empty"><nx-icon name="bot" [size]="36" /><h3>Sin agentes</h3><p>{{ currentTab().empty }}</p>
          @if ((activeScope() === 'mine' || activeScope() === 'available') && canCreate()) {
            <a class="btn primary" routerLink="/agents/new"><nx-icon name="plus" />Crear agente</a>
          }
        </div>
      }
    </div>
  `,
})
export class AgentsListPage implements OnInit {
  private readonly api = inject(AgentsScopeApi);
  private readonly access = inject(AccessApi);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  /** Pestaña activa desde `?scope=` (enlazable). */
  readonly scope = input<string>();

  readonly agents = signal<ScopedAgent[]>([]);
  readonly health = signal<Map<string, AgentHealthSummary>>(new Map());
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly allowPersonalAgents = signal(false);
  private readonly search = signal('');
  query = '';
  private requestId = 0;

  readonly tabs = computed(() => (this.auth.isAdmin() ? [...TABS, GOVERNANCE_TAB] : TABS));
  readonly activeScope = computed<AgentScope>(() => {
    const s = this.scope();
    return this.tabs().some((t) => t.id === s) ? (s as AgentScope) : 'available';
  });
  readonly currentTab = computed(() => this.tabs().find((t) => t.id === this.activeScope()) ?? TABS[0]);
  /** EDITOR+ siempre; VIEWER solo si el workspace permite agentes personales (ADR 0007 D3). */
  readonly canCreate = computed(() => this.auth.canEdit() || this.allowPersonalAgents());
  readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    if (!q) return this.agents();
    return this.agents().filter((a) =>
      [a.name, a.description ?? '', a.owner?.name ?? ''].some((v) => v.toLowerCase().includes(q)),
    );
  });

  constructor() {
    effect(() => {
      const scope = this.activeScope();
      untracked(() => void this.load(scope));
    });
  }

  ngOnInit() {
    // Una sola llamada de salud para todas las pestañas; si falla, las tarjetas se muestran sin puntaje.
    this.access.healthSummary().then((list) => this.health.set(new Map(list.map((h) => [h.agentId, h]))), () => undefined);
    if (!this.auth.canEdit()) {
      this.api.workspaceSettings().then((s) => this.allowPersonalAgents.set(!!s?.allowPersonalAgents), () => undefined);
    }
  }

  select(scope: AgentScope) {
    void this.router.navigate([], { queryParams: { scope: scope === 'available' ? null : scope }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  reload() {
    void this.load(this.activeScope());
  }

  queryChanged(value: string) {
    this.search.set(value ?? '');
  }

  isMine(a: ScopedAgent) {
    const me = this.auth.me();
    return a.myPermission === 'OWNER' || (!!me && (a.ownerId ?? a.owner?.id) === me.id);
  }

  private async load(scope: AgentScope) {
    const id = ++this.requestId;
    this.loading.set(true);
    this.error.set(null);
    this.agents.set([]);
    try {
      const list = await this.api.agents(scope);
      if (id === this.requestId) this.agents.set(list);
    } catch (e) {
      if (id === this.requestId) {
        this.agents.set([]);
        this.error.set(errorMessage(e));
      }
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }
}
