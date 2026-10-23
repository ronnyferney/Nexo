import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, OnDestroy, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { Execution } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { DurationPipe } from '../../shared/relative-time.pipe';
import { StatusBadgeComponent } from '../../shared/status-badge.component';

@Component({
  selector: 'nx-execution-detail',
  imports: [RouterLink, DatePipe, IconComponent, StatusBadgeComponent, DurationPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ex(); as e) {
      <div class="page">
        <div class="page-header">
          <div class="row">
            <a class="btn ghost icon" routerLink="/executions"><nx-icon name="arrowLeft" /></a>
            <div><h1>{{ e.workflow?.name }}</h1><p class="mono small">{{ e.id }}</p></div>
            <nx-status [status]="e.status" />
          </div>
          @if (auth.canEdit()) {
            <div class="row">
              @if (e.status === 'QUEUED' || e.status === 'RUNNING') { <button class="btn danger" (click)="cancel()"><nx-icon name="stop" />Cancelar</button> }
              <button class="btn" (click)="retry()"><nx-icon name="refresh" />Re-ejecutar</button>
              <a class="btn" [routerLink]="['/workflows', e.workflow?.id]"><nx-icon name="flow" />Abrir flujo</a>
            </div>
          }
        </div>

        <div class="grid grid-4" style="margin-bottom:16px">
          <div class="card"><div class="muted small">Disparador</div><strong>{{ e.trigger }}</strong></div>
          <div class="card"><div class="muted small">Inicio</div><strong>{{ e.startedAt ? (e.startedAt | date: 'medium') : '—' }}</strong></div>
          <div class="card"><div class="muted small">Duración</div><strong>{{ e.startedAt | duration: e.finishedAt }}</strong></div>
          <div class="card"><div class="muted small">Pasos</div><strong>{{ e.steps?.length ?? 0 }}</strong></div>
        </div>
        @if (errorSource(); as src) {
          <div class="callout info" style="margin-bottom:16px" role="note"><nx-icon name="link" [size]="16" />
            <span>Ejecución de un flujo de error, disparada por el fallo de
              @if (src.workflowId) { <a [routerLink]="['/workflows', src.workflowId]">{{ src.workflowName || 'otro flujo' }}</a> } @else { <strong>{{ src.workflowName || 'otro flujo' }}</strong> }.
              <a [routerLink]="['/executions', src.executionId]">Ver ejecución original</a></span></div>
        }
        @if (e.error) { <div class="card" style="border-color:var(--danger); margin-bottom:16px"><strong class="error-text">{{ e.error }}</strong></div> }

        <div class="grid grid-2">
          <div class="card stack">
            <h2>Línea de tiempo</h2>
            @for (s of e.steps ?? []; track s.nodeId) {
              <details class="step" [open]="s.status === 'failed'">
                <summary class="row">
                  <nx-status [status]="s.status" /><strong>{{ s.nodeName }}</strong><span class="badge">{{ s.type }}</span>
                  <span class="spacer"></span>
                  @if (s.attempts > 1) { <span class="muted small">{{ s.attempts }} intentos</span> }
                  <span class="muted small">{{ s.startedAt | duration: s.finishedAt }}</span>
                </summary>
                @if (s.error) { <div class="error-text" style="margin:8px 0">{{ s.error }}</div> }
                @if (s.input !== undefined) { <div class="muted small">Entrada</div><pre class="code-block">{{ json(s.input) }}</pre> }
                @if (s.output !== undefined) { <div class="muted small" style="margin-top:8px">Salida</div><pre class="code-block">{{ json(s.output) }}</pre> }
              </details>
            } @empty { <p class="muted">Sin pasos registrados aún.</p> }
          </div>
          <div class="stack">
            <div class="card stack"><h2>Entrada</h2><pre class="code-block">{{ json(e.input) }}</pre></div>
            <div class="card stack"><h2>Salida</h2><pre class="code-block">{{ json(e.output) }}</pre></div>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .step { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
    .step summary { cursor: pointer; list-style: none; }
  `,
})
export class ExecutionDetailPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  readonly id = input.required<string>();
  readonly ex = signal<Execution | null>(null);
  /** Si la entrada proviene de un flujo de error (ADR 0003 D6.1), datos de la ejecución original. */
  readonly errorSource = computed(() => {
    const input = this.ex()?.input as Record<string, unknown> | null | undefined;
    if (!input || typeof input !== 'object' || !('error' in input)) return null;
    const execution = input['execution'] as { id?: unknown } | null | undefined;
    const workflow = input['workflow'] as { id?: unknown; name?: unknown } | null | undefined;
    if (!execution || typeof execution.id !== 'string' || !execution.id) return null;
    return {
      executionId: execution.id,
      workflowId: typeof workflow?.id === 'string' ? workflow.id : null,
      workflowName: typeof workflow?.name === 'string' ? workflow.name : null,
    };
  });
  private timer?: ReturnType<typeof setInterval>;

  async ngOnInit() {
    await this.load();
    this.timer = setInterval(() => {
      const s = this.ex()?.status;
      if (s === 'QUEUED' || s === 'RUNNING') void this.load();
    }, 1500);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  async load() {
    this.ex.set(await this.api.execution(this.id()));
  }

  async cancel() {
    try {
      this.ex.set(await this.api.cancelExecution(this.id()));
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async retry() {
    const ex = await this.api.retryExecution(this.id());
    await this.router.navigate(['/executions', ex.id]);
  }

  json(v: unknown) {
    return v === undefined || v === null ? '—' : JSON.stringify(v, null, 2);
  }
}
