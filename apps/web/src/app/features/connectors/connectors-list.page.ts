import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { Connector, ConnectorType } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { PageHeaderComponent } from '../../layout/page-header.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { OAUTH_QUERY_CLEAR, oauthErrorMessage } from '../../shared/oauth-result';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { CONNECTOR_TYPES, DB_PRESETS, DEFAULT_CONFIG } from './connector-presets';

@Component({
  selector: 'nx-connectors-list',
  imports: [FormsModule, RouterLink, IconComponent, RelativeTimePipe, EmptyStateComponent, ErrorStateComponent, LoadingStateComponent, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nx-page-header heading="Conectores" description="Integre APIs REST, web services SOAP, GraphQL, servidores MCP y bases de datos">
        <div actions class="row wrap">
          <a class="btn" routerLink="/integrations"><nx-icon name="puzzle" />Catálogo de integraciones</a>
          @if (auth.canEdit()) {
            <button class="btn primary" (click)="creating.set(!creating())"><nx-icon name="plus" />Nuevo conector</button>
          }
        </div>
      </nx-page-header>

      @if (creating()) {
        <div class="card stack" style="margin-bottom:20px">
          <h2>Nuevo conector</h2>
          <div class="types">
            @for (t of types; track t.type) {
              <button class="type" [class.selected]="type === t.type" [attr.aria-pressed]="type === t.type" (click)="type = t.type">
                <div class="icon-tile {{ t.type }}"><nx-icon [name]="t.icon" /></div>
                <div><strong>{{ t.label }}</strong><div class="muted small">{{ t.description }}</div></div>
              </button>
            }
          </div>
          @if (type === 'DATABASE') {
            <fieldset class="presets">
              <legend class="small muted">Punto de partida</legend>
              @for (p of dbPresets; track p.id) {
                <label class="choice"><input type="radio" name="db-preset" [value]="p.id" [(ngModel)]="preset" />
                  <span><strong>{{ p.label }}</strong><span class="muted small block">{{ p.description }}</span></span></label>
              }
            </fieldset>
            <p class="muted small">Prefiera la API del sistema cuando exista. Use la base de datos directa solo si es accesible desde internet con TLS;
              si está en su red privada, use Nexo Edge.</p>
          }
          <div class="row">
            <input class="input" aria-label="Nombre del conector" placeholder="Nombre (ej. CRM Salesforce)" [(ngModel)]="name" (keyup.enter)="create()" />
            <button class="btn primary" [disabled]="name.trim().length < 2" (click)="create()">Crear</button>
          </div>
        </div>
      }

      @if (loadError()) {
        <nx-error-state title="No se pudieron cargar los conectores" message="{{ loadError() }}" (retry)="load()" />
      } @else if (loading()) {
        <nx-loading-state text="Cargando conectores…" />
      } @else if (connectors().length) {
        <div class="cards">
          @for (c of connectors(); track c.id) {
            <a class="card hover" [routerLink]="['/connectors', c.id]">
              <div class="card-title">
                <div class="icon-tile {{ c.type }}"><nx-icon [name]="iconFor(c.type)" /></div>
                <div><h3>{{ c.name }}</h3><span class="row wrap" style="gap:6px"><span class="badge">{{ c.type }}</span>@if (c.catalogId) { <span class="badge primary">Del catálogo</span> }</span></div>
              </div>
              <p class="muted small">{{ c.description || 'Sin descripción' }}</p>
              <div class="row small muted"><span>{{ c._count?.operations ?? 0 }} operaciones</span><span class="spacer"></span><span>{{ c.updatedAt | ago }}</span></div>
            </a>
          }
        </div>
      } @else if (auth.canEdit()) {
        <nx-empty-state icon="plug" title="Sin conectores"
          description="Cree el primero para que sus agentes y flujos accedan a sistemas externos."
          actionLabel="Nuevo conector" actionIcon="plus" (action)="creating.set(true)" />
      } @else {
        <nx-empty-state icon="plug" title="Sin conectores"
          description="Aún no hay conectores. Solicite a un editor que cree el primero." />
      }
    </div>
  `,
  styles: `
    .types { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
    .type { display: flex; gap: 12px; align-items: center; text-align: left; padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: inherit; font: inherit; cursor: pointer; }
    .type.selected { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-50); }
    a.card { color: inherit; }
    .presets { border: 0; padding: 0; margin: 0; display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
    .presets legend { padding: 0; margin-bottom: 6px; }
  `,
})
export class ConnectorsListPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  /** Retorno OAuth sin conector identificable (p. ej. `?oauth=error&reason=invalid_state`). */
  readonly oauth = input<string>();
  readonly oauthReason = input<string>(undefined, { alias: 'reason' });
  readonly types = CONNECTOR_TYPES;
  readonly connectors = signal<Connector[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly creating = signal(false);
  readonly dbPresets = DB_PRESETS;
  name = '';
  type: ConnectorType = 'REST';
  preset = DB_PRESETS[0].id;

  async ngOnInit() {
    this.handleOAuthReturn();
    await this.load();
  }

  private handleOAuthReturn() {
    if (!this.oauth()) return;
    if (this.oauth() === 'ok') this.toast.success('Cuenta conectada correctamente');
    else this.toast.error(oauthErrorMessage(this.oauthReason()));
    void this.router.navigate([], { relativeTo: this.route, queryParams: OAUTH_QUERY_CLEAR, queryParamsHandling: 'merge', replaceUrl: true });
  }

  async load() {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.connectors.set(await this.api.connectors());
    } catch (e) {
      this.loadError.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  iconFor(type: ConnectorType) {
    return CONNECTOR_TYPES.find((t) => t.type === type)?.icon ?? 'plug';
  }

  async create() {
    try {
      const config =
        this.type === 'DATABASE' ? { ...(DB_PRESETS.find((p) => p.id === this.preset) ?? DB_PRESETS[0]).config } : DEFAULT_CONFIG[this.type];
      const c = await this.api.createConnector({ name: this.name.trim(), type: this.type, config, auth: { type: 'none' } });
      await this.router.navigate(['/connectors', c.id]);
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
