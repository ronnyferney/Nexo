import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { CopilotApi } from '../../core/copilot.api';
import type { CopilotApplyResult, CopilotProposal, CopilotProposalKind } from '../../core/copilot.models';
import type { Agent } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { DiffViewComponent } from '../../shared/diff-view.component';
import { IconComponent } from '../../shared/icon.component';
import { proposalSections } from './proposal-diff';

export interface ProposalRef {
  id: string;
  kind: CopilotProposalKind;
  summary: string;
  status?: CopilotProposal['status'];
}

/** Tarjeta de propuesta del Copilot: resumen, diff legible por sección y botones Aplicar / Descartar. */
@Component({
  selector: 'nx-copilot-proposal',
  imports: [RouterLink, IconComponent, DiffViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="prop" [class.done]="status() !== 'PENDING'" [attr.aria-label]="'Propuesta: ' + ref().summary">
      <header class="row">
        <nx-icon [name]="ref().kind === 'CREATE_AGENT' ? 'plus' : 'diff'" [size]="16" />
        <strong class="grow">{{ ref().kind === 'CREATE_AGENT' ? 'Propuesta de agente nuevo' : 'Propuesta de cambios' }}</strong>
        @switch (status()) {
          @case ('APPLIED') { <span class="badge success">Aplicada</span> }
          @case ('DISCARDED') { <span class="badge">Descartada</span> }
          @default { <span class="badge primary">Pendiente</span> }
        }
      </header>
      <p class="sum">{{ full()?.summary || ref().summary }}</p>

      @if (error()) {
        <div class="callout danger"><nx-icon name="alert" [size]="15" /><span class="grow">{{ error() }}</span>
          <button type="button" class="btn sm" (click)="load()">Reintentar</button></div>
      } @else if (!full()) {
        <p class="muted small">Cargando detalle de la propuesta…</p>
      } @else {
        <details [open]="status() === 'PENDING' && sections().length <= 3">
          <summary class="small">Ver cambios ({{ sections().length }} {{ sections().length === 1 ? 'sección' : 'secciones' }})</summary>
          <div class="secs">
            @for (s of sections(); track s.key) {
              <nx-diff [label]="s.label" [before]="s.before" [after]="s.after" />
            } @empty { <p class="muted small">La propuesta no incluye cambios visibles.</p> }
          </div>
        </details>
      }

      @if (result(); as r) {
        <div class="callout info small" role="status"><nx-icon name="checkCircle" [size]="15" />
          <span>Se crearon {{ r.created.skills }} skills, {{ r.created.examples }} ejemplos, {{ r.created.evalCases }} casos de evaluación y {{ r.created.routines }} rutinas.</span></div>
        @if (r.pendingIntegrations.length) {
          <div class="callout warning small"><nx-icon name="puzzle" [size]="15" />
            <span>Integraciones pendientes de instalar: <strong>{{ r.pendingIntegrations.join(', ') }}</strong>.
              <a routerLink="/integrations">Ir al catálogo</a></span></div>
        }
      }

      @if (status() === 'PENDING') {
        <footer class="row">
          @if (!canApply()) { <span class="muted small grow">Necesita permiso de edición para aplicar esta propuesta.</span> }
          @else { <span class="spacer"></span> }
          <button type="button" class="btn sm" [disabled]="busy()" (click)="discard()">Descartar</button>
          @if (canApply()) {
            <button type="button" class="btn sm primary" [disabled]="busy() || !full()" (click)="apply()">
              <nx-icon name="check" [size]="14" />{{ busy() ? 'Aplicando…' : 'Aplicar' }}</button>
          }
        </footer>
      }
    </article>
  `,
  styles: `
    :host { display: block; align-self: stretch; }
    .prop { border: 1px solid var(--primary); border-radius: 12px; padding: 12px; background: var(--surface); display: flex; flex-direction: column; gap: 8px; }
    .prop.done { border-color: var(--border); }
    header { gap: 8px; color: var(--primary); }
    header strong { color: var(--text); }
    .grow { flex: 1; min-width: 0; }
    .sum { margin: 0; white-space: pre-wrap; }
    summary { cursor: pointer; color: var(--primary); font-weight: 600; }
    .secs { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
    footer { gap: 8px; flex-wrap: wrap; }
  `,
})
export class CopilotProposalCardComponent implements OnInit {
  private readonly api = inject(CopilotApi);
  private readonly toast = inject(ToastService);

  readonly ref = input.required<ProposalRef>();
  /** Agente actual, para comparar propuestas `UPDATE_AGENT`. */
  readonly agent = input<Agent | null>(null);
  readonly canApply = input(true);
  readonly applied = output<{ proposal: CopilotProposal; result: CopilotApplyResult }>();

  readonly full = signal<CopilotProposal | null>(null);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly result = signal<CopilotApplyResult | null>(null);
  private readonly localStatus = signal<CopilotProposal['status'] | null>(null);

  readonly status = computed(() => this.localStatus() ?? this.full()?.status ?? this.ref().status ?? 'PENDING');
  readonly sections = computed(() => {
    const p = this.full();
    return p ? proposalSections(p, this.agent()) : [];
  });

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.error.set(null);
    try {
      this.full.set(await this.api.proposal(this.ref().id));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async apply() {
    const p = this.full();
    if (!p || this.busy()) return;
    this.busy.set(true);
    try {
      const result = await this.api.applyProposal(p.id);
      this.result.set(result);
      this.localStatus.set('APPLIED');
      this.toast.success(p.kind === 'CREATE_AGENT' ? 'Agente creado a partir de la propuesta' : 'Cambios aplicados al agente');
      this.applied.emit({ proposal: p, result });
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async discard() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.api.discardProposal(this.ref().id);
      this.localStatus.set('DISCARDED');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
