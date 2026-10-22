import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { Connector, ConnectorType } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { CONNECTOR_TYPES, DEFAULT_CONFIG } from './connector-presets';

@Component({
  selector: 'nx-connectors-list',
  imports: [FormsModule, RouterLink, IconComponent, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div><h1>Conectores</h1><p>Integre APIs REST, web services SOAP, GraphQL y servidores MCP</p></div>
        @if (auth.canEdit()) {
          <button class="btn primary" (click)="creating.set(!creating())"><nx-icon name="plus" />Nuevo conector</button>
        }
      </div>

      @if (creating()) {
        <div class="card stack" style="margin-bottom:20px">
          <h2>Nuevo conector</h2>
          <div class="types">
            @for (t of types; track t.type) {
              <button class="type" [class.selected]="type === t.type" (click)="type = t.type">
                <div class="icon-tile {{ t.type }}"><nx-icon [name]="t.icon" /></div>
                <div><strong>{{ t.label }}</strong><div class="muted small">{{ t.description }}</div></div>
              </button>
            }
          </div>
          <div class="row">
            <input class="input" placeholder="Nombre (ej. CRM Salesforce)" [(ngModel)]="name" (keyup.enter)="create()" />
            <button class="btn primary" [disabled]="name.trim().length < 2" (click)="create()">Crear</button>
          </div>
        </div>
      }

      @if (connectors().length) {
        <div class="cards">
          @for (c of connectors(); track c.id) {
            <a class="card hover" [routerLink]="['/connectors', c.id]">
              <div class="card-title">
                <div class="icon-tile {{ c.type }}"><nx-icon [name]="iconFor(c.type)" /></div>
                <div><h3>{{ c.name }}</h3><span class="badge">{{ c.type }}</span></div>
              </div>
              <p class="muted small">{{ c.description || 'Sin descripción' }}</p>
              <div class="row small muted"><span>{{ c._count?.operations ?? 0 }} operaciones</span><span class="spacer"></span><span>{{ c.updatedAt | ago }}</span></div>
            </a>
          }
        </div>
      } @else if (!loading()) {
        <div class="card empty"><nx-icon name="plug" [size]="36" /><h3>Sin conectores</h3><p>Cree el primero para que sus agentes y flujos accedan a sistemas externos.</p></div>
      }
    </div>
  `,
  styles: `
    .types { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
    .type { display: flex; gap: 12px; align-items: center; text-align: left; padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: inherit; font: inherit; cursor: pointer; }
    .type.selected { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-50); }
    a.card { color: inherit; }
  `,
})
export class ConnectorsListPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  readonly types = CONNECTOR_TYPES;
  readonly connectors = signal<Connector[]>([]);
  readonly loading = signal(true);
  readonly creating = signal(false);
  name = '';
  type: ConnectorType = 'REST';

  async ngOnInit() {
    this.connectors.set(await this.api.connectors());
    this.loading.set(false);
  }

  iconFor(type: ConnectorType) {
    return CONNECTOR_TYPES.find((t) => t.type === type)?.icon ?? 'plug';
  }

  async create() {
    try {
      const c = await this.api.createConnector({ name: this.name.trim(), type: this.type, config: DEFAULT_CONFIG[this.type], auth: { type: 'none' } });
      await this.router.navigate(['/connectors', c.id]);
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
