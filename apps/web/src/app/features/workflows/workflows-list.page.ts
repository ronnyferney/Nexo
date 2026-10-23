import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { Workflow } from '../../core/models';
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from './templates';
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
            <button class="btn" [attr.aria-expanded]="showTemplates()" aria-controls="wf-templates" (click)="showTemplates.set(!showTemplates())">
              <nx-icon name="template" />Desde plantilla</button>
          </div>
        }
      </div>
      @if (showTemplates()) {
        <section id="wf-templates" class="card stack wf-templates" aria-label="Plantillas de flujos">
          <div class="row"><h2>Plantillas</h2><span class="spacer"></span>
            <button class="btn ghost icon sm" aria-label="Cerrar plantillas" (click)="showTemplates.set(false)"><nx-icon name="x" [size]="16" /></button></div>
          <p class="muted small">Se crea el flujo con los nodos ya conectados. {{ name.trim().length >= 2 ? 'Se usará el nombre «' + name.trim() + '».' : 'Si escribe un nombre arriba, se usará en lugar del de la plantilla.' }}</p>
          <div class="wf-template-grid">
            @for (t of templates; track t.id) {
              <button class="wf-template" [disabled]="creating()" (click)="fromTemplate(t)">
                <span class="wf-template-head"><nx-icon [name]="t.icon" /><strong>{{ t.name }}</strong></span>
                <span class="muted small">{{ t.description }}</span>
                <span class="small wf-template-meta">{{ t.definition.nodes.length }} nodos{{ t.schedule ? ' · cron ' + t.schedule : '' }}</span>
                @if (t.todo.length) {
                  <ul class="small wf-template-todo">@for (td of t.todo; track td) { <li>{{ td }}</li> }</ul>
                }
              </button>
            }
          </div>
        </section>
      }
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
  readonly showTemplates = signal(false);
  readonly creating = signal(false);
  readonly templates = WORKFLOW_TEMPLATES;
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

  async fromTemplate(t: WorkflowTemplate) {
    this.creating.set(true);
    try {
      const wf = await this.api.createWorkflow({
        name: this.name.trim().length >= 2 ? this.name.trim() : t.name,
        description: t.description,
        definition: structuredClone(t.definition),
        ...(t.schedule ? { schedule: t.schedule } : {}),
      });
      this.toast.success('Flujo creado desde plantilla. Complete los nodos pendientes.');
      await this.router.navigate(['/workflows', wf.id]);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.creating.set(false);
    }
  }
}
