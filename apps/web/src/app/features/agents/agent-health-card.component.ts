import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, output, signal, untracked } from '@angular/core';
import { AccessApi } from '../../core/access.api';
import {
  type AgentHealth,
  HEALTH_CATEGORY_LABELS,
  HEALTH_LEVEL_META,
  type HealthCategory,
  type HealthCheck,
} from '../../core/access.models';
import { errorMessage } from '../../core/api.service';
import { IconComponent } from '../../shared/icon.component';

const CATEGORY_ORDER: HealthCategory[] = ['PROFILE', 'TOOLS', 'KNOWLEDGE', 'QUALITY', 'COST', 'OPERATIONS'];
const SEVERITY_RANK = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
const RADIUS = 26;
const CIRC = 2 * Math.PI * RADIUS;

/**
 * Tarjeta de salud del agente (ADR 0006 D3): puntaje 0–100 con anillo, nivel y chequeos pendientes agrupados por
 * categoría, cada uno con su recomendación y acción (abrir una pestaña o preguntar al Copilot). Sin costo de IA.
 */
@Component({
  selector: 'nx-agent-health',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card health" aria-labelledby="health-title" tabindex="-1">
      @if (error()) {
        <div class="row"><nx-icon name="alert" [size]="16" /><span class="grow small">No se pudo calcular la salud: {{ error() }}</span>
          <button type="button" class="btn sm" (click)="load()">Reintentar</button></div>
      } @else if (!health()) {
        <p class="muted small m0" id="health-title">Calculando la salud del agente…</p>
      } @else {
        @let h = health()!;
        <div class="top">
          <svg class="ring {{ tone() }}" width="64" height="64" viewBox="0 0 64 64" role="img" [attr.aria-label]="'Puntaje de salud ' + h.score + ' de 100'">
            <circle cx="32" cy="32" [attr.r]="r" class="track" />
            <circle cx="32" cy="32" [attr.r]="r" class="val" [attr.stroke-dasharray]="circ" [attr.stroke-dashoffset]="offset()" transform="rotate(-90 32 32)" />
            <text x="32" y="37" text-anchor="middle">{{ h.score }}</text>
          </svg>
          <div class="grow">
            <div class="row wrap g6"><h3 id="health-title">Salud del agente</h3><span class="badge {{ tone() }}">{{ levelLabel() }}</span></div>
            <p class="muted small m0">
              @if (pending().length) { {{ pending().length }} {{ pending().length === 1 ? 'recomendación pendiente' : 'recomendaciones pendientes' }} · }
              {{ passedCount() }} de {{ h.checks.length }} chequeos superados
            </p>
          </div>
          @if (pending().length) {
            <button type="button" class="btn sm" [attr.aria-expanded]="expanded()" aria-controls="health-detail" (click)="expanded.set(!expanded())">
              {{ expanded() ? 'Ocultar' : 'Ver detalle' }}<nx-icon [name]="expanded() ? 'chevronUp' : 'chevronDown'" [size]="14" /></button>
          }
        </div>
        @if (expanded() && pending().length) {
          <div id="health-detail" class="groups">
            @for (g of groups(); track g.category) {
              <div class="group">
                <h4 class="small">{{ g.label }}</h4>
                <ul>
                  @for (c of g.checks; track c.id) {
                    <li class="chk {{ c.severity }}">
                      <nx-icon [name]="c.severity === 'INFO' ? 'info' : 'alert'" [size]="15" />
                      <div class="grow">
                        <strong>{{ c.message }}</strong>
                        <span class="block small muted">{{ c.recommendation }}</span>
                      </div>
                      @if (c.action; as a) {
                        @if (a.type === 'OPEN_TAB' && a.tab) {
                          <button type="button" class="btn sm" (click)="openTab.emit(a.tab)">Abrir</button>
                        } @else if (a.type === 'COPILOT' && copilot()) {
                          <button type="button" class="btn sm cp" (click)="askCopilot.emit(a.prompt || c.recommendation)"><nx-icon name="sparkles" [size]="13" />Ayúdame</button>
                        }
                      }
                    </li>
                  }
                </ul>
              </div>
            }
          </div>
        }
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .health { padding: 14px 16px; outline: none; }
    .top { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .grow { flex: 1; min-width: 0; }
    .g6 { gap: 6px; }
    .m0 { margin: 0; }
    .ring { flex-shrink: 0; --c: var(--primary); }
    .ring.danger { --c: var(--danger); } .ring.warning { --c: var(--warning); } .ring.info { --c: var(--info); } .ring.success { --c: var(--success); }
    .ring .track { fill: none; stroke: var(--surface-2); stroke-width: 7; }
    .ring .val { fill: none; stroke: var(--c); stroke-width: 7; stroke-linecap: round; transition: stroke-dashoffset 0.4s; }
    .ring text { font-size: 17px; font-weight: 750; fill: var(--text); }
    .groups { display: flex; flex-direction: column; gap: 12px; margin-top: 14px; border-top: 1px solid var(--border); padding-top: 12px; }
    .group h4 { color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .chk { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; }
    .chk.CRITICAL { border-color: var(--danger); background: var(--danger-50); }
    .chk.CRITICAL > nx-icon { color: var(--danger); }
    .chk.WARNING > nx-icon { color: var(--warning); }
    .chk.INFO > nx-icon { color: var(--info); }
    .chk > nx-icon { margin-top: 2px; }
    .btn.cp { color: var(--brand-violet-text); }
  `,
})
export class AgentHealthCardComponent {
  private readonly api = inject(AccessApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly agentId = input.required<string>();
  /** Muestra las acciones «Ayúdame» (solo si el Copilot está disponible para el usuario). */
  readonly copilot = input(true);
  readonly openTab = output<string>();
  readonly askCopilot = output<string>();
  readonly loaded = output<AgentHealth>();

  readonly r = RADIUS;
  readonly circ = CIRC;
  readonly health = signal<AgentHealth | null>(null);
  readonly error = signal<string | null>(null);
  readonly expanded = signal(false);

  readonly tone = computed(() => HEALTH_LEVEL_META[this.health()?.level ?? 'CRITICAL'].tone);
  readonly levelLabel = computed(() => HEALTH_LEVEL_META[this.health()?.level ?? 'CRITICAL'].label);
  readonly offset = computed(() => CIRC * (1 - Math.max(0, Math.min(100, this.health()?.score ?? 0)) / 100));
  readonly pending = computed(() => (this.health()?.checks ?? []).filter((c) => !c.passed));
  readonly passedCount = computed(() => (this.health()?.checks ?? []).filter((c) => c.passed).length);
  readonly groups = computed(() =>
    CATEGORY_ORDER.map((category) => ({
      category,
      label: HEALTH_CATEGORY_LABELS[category],
      checks: this.pending()
        .filter((c) => c.category === category)
        .sort((a: HealthCheck, b: HealthCheck) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]),
    })).filter((g) => g.checks.length),
  );

  constructor() {
    effect(() => {
      this.agentId();
      untracked(() => {
        this.health.set(null);
        this.expanded.set(false);
        void this.load();
      });
    });
  }

  async load() {
    this.error.set(null);
    try {
      const h = await this.api.health(this.agentId());
      this.health.set(h);
      if (h.level === 'CRITICAL') this.expanded.set(true);
      this.loaded.emit(h);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  /** Despliega el detalle y lleva el foco a la tarjeta (enlace desde el Copilot con cupo agotado). */
  reveal() {
    this.expanded.set(true);
    const el = this.host.nativeElement;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.querySelector<HTMLElement>('.health')?.focus({ preventScroll: true });
  }
}
