import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { Agent } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';

@Component({
  selector: 'nx-agents-list',
  imports: [FormsModule, RouterLink, IconComponent, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div><h1>Agentes de IA</h1><p>Asistentes con instrucciones, modelo y herramientas conectadas a sus sistemas</p></div>
        @if (auth.canEdit()) {
          <div class="row">
            <input class="input" style="width:260px" placeholder="Nombre del nuevo agente" [(ngModel)]="name" (keyup.enter)="create()" />
            <button class="btn primary" [disabled]="name.trim().length < 2" (click)="create()"><nx-icon name="plus" />Crear agente</button>
          </div>
        }
      </div>
      @if (agents().length) {
        <div class="cards">
          @for (a of agents(); track a.id) {
            <a class="card hover" [routerLink]="['/agents', a.id]" style="color:inherit">
              <div class="card-title"><div class="icon-tile"><nx-icon name="bot" /></div>
                <div><h3>{{ a.name }}</h3><span class="badge primary">{{ a.model }}</span></div></div>
              <p class="muted small">{{ a.description || (a.systemPrompt ? a.systemPrompt.slice(0, 110) + '…' : 'Sin instrucciones aún') }}</p>
              <div class="row small muted"><span>{{ a._count?.tools ?? 0 }} tools · {{ a._count?.conversations ?? 0 }} conversaciones</span><span class="spacer"></span><span>{{ a.updatedAt | ago }}</span></div>
            </a>
          }
        </div>
      } @else if (!loading()) {
        <div class="card empty"><nx-icon name="bot" [size]="36" /><h3>Sin agentes</h3><p>Cree un agente y conéctelo a las operaciones de sus conectores.</p></div>
      }
    </div>
  `,
})
export class AgentsListPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  readonly agents = signal<Agent[]>([]);
  readonly loading = signal(true);
  name = '';

  async ngOnInit() {
    this.agents.set(await this.api.agents());
    this.loading.set(false);
  }

  async create() {
    try {
      const providers = await this.api.providers();
      const anthropic = providers.find((p) => p.id === 'anthropic');
      const provider = anthropic?.configured ? anthropic : providers.find((p) => p.configured)!;
      const agent = await this.api.createAgent({
        name: this.name.trim(),
        provider: provider.id,
        model: provider.models[0].id,
        systemPrompt: 'Eres un asistente profesional. Usa las herramientas disponibles cuando sea necesario y responde en español de forma clara y concisa.',
      });
      await this.router.navigate(['/agents', agent.id]);
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
