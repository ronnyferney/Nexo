import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AccessApi } from '../../../core/access.api';
import { AgentsScopeApi } from '../../../core/agents-scope.api';
import type { ExploreAgent } from '../../../core/agents-scope.models';
import { errorMessage } from '../../../core/api.service';
import { ToastService } from '../../../core/toast.service';
import { HealthBadgeComponent, LaunchBadgeComponent, VisibilityBadgeComponent } from '../../../shared/agent-badges.component';
import { IconComponent } from '../../../shared/icon.component';

type VisibilityFilter = 'ALL' | 'TEAM' | 'WORKSPACE';

/** Galería interna de agentes de equipo y empresa disponibles para el usuario (ADR 0007, `GET /agents/explore`). */
@Component({
  selector: 'nx-explore-agents',
  imports: [FormsModule, RouterLink, IconComponent, VisibilityBadgeComponent, LaunchBadgeComponent, HealthBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div><h1>Explorar agentes</h1><p>Agentes de su equipo y de la empresa que puede usar o duplicar como punto de partida</p></div>
        <a class="btn" routerLink="/agents"><nx-icon name="arrowLeft" />Mis agentes</a>
      </div>

      <div class="row wrap" style="margin-bottom:16px">
        <input class="input" style="max-width:340px" type="search" placeholder="Buscar por nombre, descripción o dueño" aria-label="Buscar agentes"
          [ngModel]="query()" (ngModelChange)="query.set($event ?? '')" />
        <div class="segmented" role="group" aria-label="Filtrar por visibilidad">
          @for (f of filters; track f.id) {
            <button type="button" [class.active]="filter() === f.id" [attr.aria-pressed]="filter() === f.id" (click)="filter.set(f.id)">{{ f.label }}</button>
          }
        </div>
        <span class="spacer"></span>
        @if (!loading() && !error()) { <span class="muted small">{{ filtered().length }} de {{ agents().length }} agentes</span> }
      </div>

      @if (error()) {
        <div class="card empty"><nx-icon name="alert" [size]="28" /><h3>No se pudo cargar la galería</h3><p>{{ error() }}</p>
          <button class="btn" (click)="load()">Reintentar</button></div>
      } @else if (loading()) {
        <div class="card empty"><p>Cargando…</p></div>
      } @else if (filtered().length) {
        <div class="cards">
          @for (a of filtered(); track a.id) {
            <div class="card stack explore-card">
              <div class="card-title"><div class="icon-tile"><nx-icon name="bot" /></div>
                <div style="min-width:0"><h3>{{ a.name }}</h3>
                  <div class="chips">
                    <nx-visibility-badge [visibility]="a.visibility" />
                    <nx-launch-badge [status]="a.launchStatus" />
                    <nx-health-badge [score]="a.healthScore" />
                  </div>
                </div></div>
              <p class="muted small explore-desc">{{ a.description || 'Sin descripción.' }}</p>
              <div class="row small muted">
                @if (a.owner) { <span><nx-icon name="user" [size]="13" /> {{ a.owner.name }}</span> }
                @if (a.myPermission === 'EDIT') { <span class="badge info">Puede editar</span> }
              </div>
              <div class="row">
                <a class="btn primary sm" [routerLink]="['/agents', a.id]"><nx-icon name="send" [size]="14" />Conversar</a>
                <button type="button" class="btn sm" [disabled]="duplicating() === a.id" (click)="duplicate(a)">
                  <nx-icon name="copy" [size]="14" />{{ duplicating() === a.id ? 'Duplicando…' : 'Duplicar en mis agentes' }}</button>
              </div>
            </div>
          }
        </div>
      } @else if (agents().length) {
        <div class="card empty"><nx-icon name="search" [size]="36" /><h3>Sin resultados</h3><p>Ningún agente coincide con la búsqueda.</p></div>
      } @else {
        <div class="card empty"><nx-icon name="users" [size]="36" /><h3>Aún no hay agentes compartidos</h3>
          <p>Cuando alguien comparta un agente con su equipo o lo publique para la empresa, aparecerá aquí.</p></div>
      }
    </div>
  `,
})
export class ExploreAgentsPage implements OnInit {
  private readonly api = inject(AgentsScopeApi);
  private readonly access = inject(AccessApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly agents = signal<ExploreAgent[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly duplicating = signal<string | null>(null);
  readonly query = signal('');
  readonly filter = signal<VisibilityFilter>('ALL');
  readonly filters: { id: VisibilityFilter; label: string }[] = [
    { id: 'ALL', label: 'Todos' },
    { id: 'TEAM', label: 'Equipo' },
    { id: 'WORKSPACE', label: 'Empresa' },
  ];

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const f = this.filter();
    return this.agents().filter(
      (a) =>
        (f === 'ALL' || a.visibility === f) &&
        (!q || [a.name, a.description ?? '', a.owner?.name ?? ''].some((v) => v.toLowerCase().includes(q))),
    );
  });

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.agents.set(await this.api.explore());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async duplicate(a: ExploreAgent) {
    this.duplicating.set(a.id);
    try {
      const copy = await this.access.duplicate(a.id);
      this.toast.success(`Se creó «${copy.name}» en sus agentes (personal).`);
      await this.router.navigate(['/agents', copy.id]);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.duplicating.set(null);
    }
  }
}
