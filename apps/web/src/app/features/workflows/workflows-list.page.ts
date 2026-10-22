import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { Workflow } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';

@Component({
  selector: 'nx-workflows-list',
  imports: [FormsModule, RouterLink, IconComponent, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div><h1>Flujos de automatización</h1><p>Orqueste conectores, condiciones y agentes en un grafo visual</p></div>
        @if (auth.canEdit()) {
          <div class="row">
            <input class="input" style="width:260px" placeholder="Nombre del nuevo flujo" [(ngModel)]="name" (keyup.enter)="create()" />
            <button class="btn primary" [disabled]="name.trim().length < 2" (click)="create()"><nx-icon name="plus" />Crear flujo</button>
          </div>
        }
      </div>
      @if (workflows().length) {
        <div class="card" style="padding:0">
          <table class="table">
            <thead><tr><th>Nombre</th><th>Estado</th><th>Programación</th><th>Ejecuciones</th><th>Versión</th><th>Actualizado</th></tr></thead>
            <tbody>
              @for (w of workflows(); track w.id) {
                <tr class="clickable" [routerLink]="['/workflows', w.id]">
                  <td><strong>{{ w.name }}</strong><div class="muted small">{{ w.description }}</div></td>
                  <td>@if (w.active) { <span class="badge success"><span class="dot"></span>Activo</span> } @else { <span class="badge">Borrador</span> }</td>
                  <td class="mono small">{{ w.schedule || '—' }}</td>
                  <td>{{ w._count?.executions ?? 0 }}</td>
                  <td>v{{ w.version }}</td>
                  <td class="muted small">{{ w.updatedAt | ago }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else if (!loading()) {
        <div class="card empty"><nx-icon name="flow" [size]="36" /><h3>Sin flujos</h3><p>Cree un flujo para automatizar procesos entre sus sistemas.</p></div>
      }
    </div>
  `,
})
export class WorkflowsListPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  readonly workflows = signal<Workflow[]>([]);
  readonly loading = signal(true);
  name = '';

  async ngOnInit() {
    this.workflows.set(await this.api.workflows());
    this.loading.set(false);
  }

  async create() {
    try {
      const wf = await this.api.createWorkflow({ name: this.name.trim() });
      await this.router.navigate(['/workflows', wf.id]);
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
