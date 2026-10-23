import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { errorMessage } from '../../core/api.service';
import { StudioApi } from '../../core/studio.api';
import type { PromptPreview } from '../../core/studio.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { NumberPipe } from '../../shared/usd.pipe';

/** Vista previa del prompt compuesto y las herramientas que recibe el modelo (`GET /agents/:id/prompt-preview`). */
@Component({
  selector: 'nx-agent-prompt-preview',
  imports: [IconComponent, NumberPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      <div class="callout info"><nx-icon name="info" [size]="16" />
        <span>Esto es exactamente lo que recibe el modelo, según la <strong>última versión guardada</strong>. Guarde antes de revisar sus cambios.</span></div>
      @if (dirty()) {
        <div class="callout warning"><nx-icon name="alert" [size]="16" /><span>Hay cambios sin guardar que aún no se reflejan aquí.</span></div>
      }
      @if (loading()) {
        <div class="card empty"><p>Componiendo el prompt…</p></div>
      } @else if (error()) {
        <div class="card empty"><nx-icon name="alert" [size]="28" /><h3>No se pudo obtener la vista previa</h3><p>{{ error() }}</p>
          <button class="btn" (click)="load()">Reintentar</button></div>
      } @else if (data(); as d) {
        <div class="card stack">
          <div class="row wrap">
            <strong>Prompt del sistema</strong><span class="badge">{{ d.system.length | num }} caracteres</span><span class="spacer"></span>
            <button class="btn sm" (click)="copy(d.system)"><nx-icon name="copy" [size]="14" />Copiar</button>
            <button class="btn sm" (click)="load()"><nx-icon name="refresh" [size]="14" />Actualizar</button>
          </div>
          <pre class="code-block system">{{ d.system || '(vacío)' }}</pre>
        </div>
        <div class="card stack">
          <div class="row"><nx-icon name="tool" [size]="16" /><strong>Herramientas</strong><span class="badge">{{ d.tools.length }}</span></div>
          @for (t of d.tools; track t.name) {
            <div class="tool-row"><code>{{ t.name }}</code><span class="muted small">{{ t.description }}</span></div>
          } @empty {
            <p class="muted small">El agente no tiene herramientas.</p>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .system { max-height: 520px; font-size: 12px; }
    .tool-row { display: flex; flex-direction: column; gap: 2px; padding: 8px 0; border-top: 1px solid var(--border); }
    .tool-row:first-of-type { border-top: 0; }
  `,
})
export class AgentPromptPreviewComponent implements OnInit {
  private readonly studio = inject(StudioApi);
  private readonly toast = inject(ToastService);
  readonly agentId = input.required<string>();
  readonly dirty = input(false);
  readonly data = signal<PromptPreview | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.data.set(await this.studio.promptPreview(this.agentId()));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.toast.success('Prompt copiado');
    } catch {
      this.toast.error('No se pudo copiar al portapapeles');
    }
  }
}
