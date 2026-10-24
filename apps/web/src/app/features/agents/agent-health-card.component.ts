import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, output, signal, untracked } from '@angular/core';
import { AccessApi } from '../../core/access.api';
import {
  type AgentHealth,
  countFindingsBySeverity,
  derivePublishState,
  HEALTH_CATEGORY_LABELS,
  HEALTH_LEVEL_META,
  HEALTH_SEVERITY_META,
  type HealthCheck,
  type HealthSeverity,
  PUBLISH_STATE_META,
} from '../../core/access.models';
import { errorMessage } from '../../core/api.service';
import { IconComponent } from '../../shared/icon.component';

const SEVERITY_ORDER: HealthSeverity[] = ['CRITICAL', 'WARNING', 'INFO'];
/** Etiqueta en español de la sección del editor a la que lleva una acción de tipo OPEN_TAB. */
const TAB_LABELS: Record<string, string> = {
  profile: 'Perfil',
  tools: 'Herramientas',
  knowledge: 'Conocimiento',
  training: 'Entrenamiento',
  model: 'Modelo',
};

/**
 * Panel de salud del agente (ADR 0006 D3, §4.3 del rediseño UX). Encabeza con el **estado de publicación**
 * («Preparado para publicar» / «Publicable con advertencias» / «Publicación bloqueada»), derivado de la severidad
 * de los hallazgos —no solo del puntaje—, y lista los hallazgos con su severidad, recomendación y una acción que
 * enlaza a la sección correspondiente del editor (o pregunta al Copilot). El puntaje queda como dato secundario.
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
        @let ps = publish();
        <div class="state {{ ps.tone }}" role="status">
          <nx-icon [name]="ps.icon" [size]="22" />
          <div class="grow">
            <div class="row wrap g6">
              <h3 id="health-title">{{ ps.label }}</h3>
              <span class="badge {{ tone() }}" [title]="'Puntaje de salud ' + h.score + ' de 100'">{{ h.score }}/100 · {{ levelLabel() }}</span>
            </div>
            <p class="muted small m0">{{ ps.description }}</p>
          </div>
        </div>

        @if (pending().length) {
          <div class="counts" aria-hidden="true">
            @for (s of severityOrder; track s) {
              @if (counts()[s]) {
                <span class="chip {{ meta(s).tone }}"><nx-icon [name]="meta(s).icon" [size]="13" />{{ counts()[s] }} {{ meta(s).label }}{{ counts()[s] === 1 ? '' : 's' }}</span>
              }
            }
            <span class="grow"></span>
            <button type="button" class="btn sm" [attr.aria-expanded]="expanded()" aria-controls="health-detail" (click)="expanded.set(!expanded())">
              {{ expanded() ? 'Ocultar hallazgos' : 'Ver hallazgos' }}<nx-icon [name]="expanded() ? 'chevronUp' : 'chevronDown'" [size]="14" /></button>
          </div>

          @if (expanded()) {
            <ul id="health-detail" class="findings">
              @for (c of findings(); track c.id) {
                <li class="chk {{ c.severity }}">
                  <span class="badge {{ meta(c.severity).tone }} sev"><nx-icon [name]="meta(c.severity).icon" [size]="12" />{{ meta(c.severity).label }}</span>
                  <div class="grow">
                    <strong class="block">{{ c.message }}</strong>
                    <span class="block small muted">{{ c.recommendation }}</span>
                    <span class="block xs muted cat">{{ categoryLabel(c) }}</span>
                  </div>
                  @if (c.action; as a) {
                    @if (a.type === 'OPEN_TAB' && a.tab) {
                      <button type="button" class="btn sm" (click)="openTab.emit(a.tab!)"><nx-icon name="externalLink" [size]="13" />{{ actionLabel(a.tab) }}</button>
                    } @else if (a.type === 'COPILOT' && copilot()) {
                      <button type="button" class="btn sm cp" (click)="askCopilot.emit(a.prompt || c.recommendation)"><nx-icon name="sparkles" [size]="13" />Ayúdame</button>
                    }
                  }
                </li>
              }
            </ul>
          }
        } @else {
          <p class="muted small m0 all-ok"><nx-icon name="checkCircle" [size]="15" />Todas las revisiones superadas ({{ h.checks.length }}).</p>
        }
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .health { padding: 14px 16px; outline: none; display: flex; flex-direction: column; gap: 12px; }
    .grow { flex: 1; min-width: 0; }
    .g6 { gap: 6px; }
    .m0 { margin: 0; }
    .block { display: block; }
    .xs { font-size: 11px; }
    .state { display: flex; align-items: flex-start; gap: 12px; padding: 12px; border: 1px solid var(--border); border-left-width: 4px; border-radius: 10px; }
    .state h3 { margin: 0; }
    .state.success { border-left-color: var(--success); } .state.success > nx-icon { color: var(--success); }
    .state.warning { border-left-color: var(--warning); background: var(--warning-50); } .state.warning > nx-icon { color: var(--warning); }
    .state.danger { border-left-color: var(--danger); background: var(--danger-50); } .state.danger > nx-icon { color: var(--danger); }
    .state > nx-icon { margin-top: 1px; flex-shrink: 0; }
    .counts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .chip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 999px; }
    .chip.danger { color: var(--danger); background: var(--danger-50); } .chip.warning { color: var(--warning); background: var(--warning-50); } .chip.info { color: var(--info); background: var(--surface-2); }
    .findings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .chk { display: flex; gap: 10px; align-items: flex-start; padding: 10px; border: 1px solid var(--border); border-radius: 10px; }
    .chk.CRITICAL { border-color: var(--danger); }
    .badge.sev { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; }
    .cat { text-transform: uppercase; letter-spacing: 0.04em; margin-top: 2px; }
    .all-ok { display: flex; align-items: center; gap: 6px; } .all-ok > nx-icon { color: var(--success); }
    .btn.cp { color: var(--brand-violet-text); }
    @media (max-width: 440px) { .chk { flex-wrap: wrap; } }
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

  readonly severityOrder = SEVERITY_ORDER;
  readonly health = signal<AgentHealth | null>(null);
  readonly error = signal<string | null>(null);
  readonly expanded = signal(false);

  readonly tone = computed(() => HEALTH_LEVEL_META[this.health()?.level ?? 'CRITICAL'].tone);
  readonly levelLabel = computed(() => HEALTH_LEVEL_META[this.health()?.level ?? 'CRITICAL'].label);
  readonly publish = computed(() => PUBLISH_STATE_META[derivePublishState(this.health()?.checks ?? [])]);
  readonly counts = computed(() => countFindingsBySeverity(this.health()?.checks ?? []));
  readonly pending = computed(() => (this.health()?.checks ?? []).filter((c) => !c.passed));
  /** Hallazgos ordenados por severidad (bloqueantes primero); orden estable dentro de cada severidad. */
  readonly findings = computed(() =>
    [...this.pending()].sort(
      (a, b) => HEALTH_SEVERITY_META[a.severity].rank - HEALTH_SEVERITY_META[b.severity].rank,
    ),
  );

  meta(s: HealthSeverity) {
    return HEALTH_SEVERITY_META[s];
  }

  categoryLabel(c: HealthCheck) {
    return HEALTH_CATEGORY_LABELS[c.category];
  }

  actionLabel(tab: string) {
    return 'Ir a ' + (TAB_LABELS[tab] ?? 'la sección');
  }

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
      // Despliega los hallazgos de entrada cuando la publicación está bloqueada, para orientar la corrección.
      if (derivePublishState(h.checks) === 'BLOCKED') this.expanded.set(true);
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
