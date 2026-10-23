import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { AgentsScopeApi } from '../../core/agents-scope.api';
import type { WorkspaceSettings } from '../../core/agents-scope.models';
import { errorMessage } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

/** Ajustes del workspace (ADR 0007 D3): política de agentes personales. Solo ADMIN/OWNER. */
@Component({
  selector: 'nx-admin-workspace-settings',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Ajustes del workspace</h1><p>Políticas que aplican a todos los miembros</p></div></div>

      @if (error()) {
        <div class="card empty"><nx-icon name="alert" [size]="28" /><h3>No se pudieron cargar los ajustes</h3><p>{{ error() }}</p>
          <button class="btn" (click)="load()">Reintentar</button></div>
      } @else {
        <div class="card stack" style="max-width:760px">
          <div class="card-title"><div class="icon-tile"><nx-icon name="bot" /></div>
            <div><h2>Agentes personales</h2><p class="muted small">Quién puede crear agentes privados (🔒 Personal)</p></div></div>

          <div class="row" style="align-items:flex-start; gap:14px">
            <label class="switch" style="margin-top:2px">
              <input type="checkbox" id="allow-personal" [checked]="settings()?.allowPersonalAgents ?? false"
                [disabled]="!settings() || saving()" (change)="toggle($any($event.target).checked)"
                aria-describedby="allow-personal-hint" />
              <span></span>
            </label>
            <div class="stack" style="gap:4px">
              <label for="allow-personal"><strong>Permitir agentes personales a todos los miembros</strong></label>
              <p id="allow-personal-hint" class="muted small" style="margin:0">
                Activado, cualquier miembro —incluidos los de rol VIEWER (lector)— puede crear agentes personales que solo él ve y usa.
                Desactivado, solo los roles EDITOR, ADMIN y OWNER pueden crear agentes.
              </p>
            </div>
          </div>

          <div class="callout info">
            <nx-icon name="info" [size]="16" />
            <span>Compartir un agente con un equipo o publicarlo para toda la empresa siempre requiere rol EDITOR o superior,
              y publicarlo para la empresa exige que esté lanzado. Desactivar esta opción no elimina los agentes personales existentes.</span>
          </div>
        </div>
      }
    </div>
  `,
})
export class WorkspaceSettingsPage implements OnInit {
  private readonly api = inject(AgentsScopeApi);
  private readonly toast = inject(ToastService);
  readonly settings = signal<WorkspaceSettings | null>(null);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.error.set(null);
    try {
      this.settings.set(await this.api.workspaceSettings());
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async toggle(allowPersonalAgents: boolean) {
    const previous = this.settings();
    this.settings.set({ ...(previous ?? {}), allowPersonalAgents });
    this.saving.set(true);
    try {
      this.settings.set(await this.api.updateWorkspaceSettings({ allowPersonalAgents }));
      this.toast.success(allowPersonalAgents ? 'Todos los miembros pueden crear agentes personales' : 'Solo EDITOR o superior puede crear agentes');
    } catch (e) {
      this.settings.set(previous);
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
