import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { AccessApi } from '../../core/access.api';
import {
  type AgentHealth,
  countFindingsBySeverity,
  derivePublishState,
  HEALTH_CATEGORY_LABELS,
  HEALTH_LEVEL_META,
  HEALTH_SEVERITY_META,
  type HealthCheck,
  type HealthLevel,
  type HealthSeverity,
  PUBLISH_STATE_META,
} from '../../core/access.models';
import { errorMessage } from '../../core/api.service';
import { IconComponent } from '../../shared/icon.component';

const SEVERITY_ORDER: HealthSeverity[] = ['CRITICAL', 'WARNING', 'INFO'];
const RADIUS = 26;
const CIRC = 2 * Math.PI * RADIUS;
/** Tono del anillo por nivel: rojo (crítico), ámbar (necesita trabajo), verde (bueno/excelente). */
const RING_TONE: Record<HealthLevel, 'danger' | 'warning' | 'success'> = {
  CRITICAL: 'danger',
  NEEDS_WORK: 'warning',
  GOOD: 'success',
  EXCELLENT: 'success',
};
/** Etiqueta en español de la sección del editor a la que lleva una acción de tipo OPEN_TAB. */
const TAB_LABELS: Record<string, string> = {
  profile: 'Perfil',
  tools: 'Herramientas',
  knowledge: 'Conocimiento',
  training: 'Entrenamiento',
  model: 'Modelo',
};

/**
 * Panel de salud del agente (ADR 0006 D3, §4.3 del rediseño UX, RX-5b). Tarjeta **compacta** por defecto: anillo de
 * puntaje coloreado por nivel + estado de publicación («Preparado para publicar» / «Publicable con advertencias» /
 * «Publicación bloqueada», derivado de la severidad de los hallazgos, no solo del puntaje) + resumen corto + botón
 * «Ver detalle». El detalle (banner + chips por severidad + hallazgos con sus acciones) se abre en un **modal**:
 * cada acción cierra el modal y emite `openTab` (sección del editor) o `askCopilot`.
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
        <div class="top">
          <svg class="ring {{ ringTone() }}" width="60" height="60" viewBox="0 0 64 64" role="img" [attr.aria-label]="'Puntaje de salud ' + h.score + ' de 100'">
            <circle cx="32" cy="32" [attr.r]="r" class="track" />
            <circle cx="32" cy="32" [attr.r]="r" class="val" [attr.stroke-dasharray]="circ" [attr.stroke-dashoffset]="offset()" transform="rotate(-90 32 32)" />
            <text x="32" y="37" text-anchor="middle">{{ h.score }}</text>
          </svg>
          <div class="grow">
            <div class="row wrap g6">
              <h3 id="health-title">{{ ps.label }}</h3>
              <span class="badge {{ ringTone() }}" [title]="'Puntaje de salud ' + h.score + ' de 100'">{{ h.score }}/100 · {{ levelLabel() }}</span>
            </div>
            <p class="muted small m0">{{ summary() }}</p>
          </div>
          <button type="button" class="btn sm" (click)="open()"><nx-icon name="externalLink" [size]="14" />Ver detalle</button>
        </div>
      }
    </section>

    <dialog #dlg class="modal" aria-labelledby="health-modal-title" (cancel)="onCancel($event)" (close)="modalOpen.set(false)">
      @if (health(); as h) {
        @let ps = publish();
        <div class="modal-head">
          <div class="icon-tile {{ ps.tone }}"><nx-icon [name]="ps.icon" /></div>
          <div class="grow"><h2 id="health-modal-title">Salud del agente</h2>
            <span class="small muted">{{ h.score }}/100 · {{ levelLabel() }}</span></div>
          <button type="button" class="btn icon ghost" (click)="close()" aria-label="Cerrar"><nx-icon name="x" [size]="18" /></button>
        </div>
        <div class="modal-body">
          <div class="state {{ ps.tone }}" role="status">
            <nx-icon [name]="ps.icon" [size]="22" />
            <div class="grow">
              <strong class="block">{{ ps.label }}</strong>
              <span class="block small muted">{{ ps.description }}</span>
            </div>
          </div>

          @if (pending().length) {
            <div class="counts">
              @for (s of severityOrder; track s) {
                @if (counts()[s]) {
                  <span class="chip {{ meta(s).tone }}"><nx-icon [name]="meta(s).icon" [size]="13" />{{ counts()[s] }} {{ meta(s).label }}{{ counts()[s] === 1 ? '' : 's' }}</span>
                }
              }
            </div>
            <ul class="findings">
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
                      <button type="button" class="btn sm" (click)="goToTab(a.tab!)"><nx-icon name="externalLink" [size]="13" />{{ actionLabel(a.tab) }}</button>
                    } @else if (a.type === 'COPILOT' && copilot()) {
                      <button type="button" class="btn sm cp" (click)="ask(a.prompt || c.recommendation)"><nx-icon name="sparkles" [size]="13" />Ayúdame</button>
                    }
                  }
                </li>
              }
            </ul>
          } @else {
            <p class="muted small m0 all-ok"><nx-icon name="checkCircle" [size]="15" />Todas las revisiones superadas ({{ h.checks.length }}).</p>
          }
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" (click)="close()">Cerrar</button>
        </div>
      }
    </dialog>
  `,
  styles: `
    :host { display: block; }
    .health { padding: 14px 16px; outline: none; }
    .top { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .top h3 { margin: 0; }
    .grow { flex: 1; min-width: 0; }
    .g6 { gap: 6px; }
    .m0 { margin: 0; }
    .block { display: block; }
    .xs { font-size: 11px; }
    .ring { flex-shrink: 0; --c: var(--primary); }
    .ring.danger { --c: var(--danger); } .ring.warning { --c: var(--warning); } .ring.success { --c: var(--success); }
    .ring .track { fill: none; stroke: var(--surface-2); stroke-width: 7; }
    .ring .val { fill: none; stroke: var(--c); stroke-width: 7; stroke-linecap: round; transition: stroke-dashoffset 0.4s; }
    .ring text { font-size: 17px; font-weight: 750; fill: var(--text); }
    .state { display: flex; align-items: flex-start; gap: 12px; padding: 12px; border: 1px solid var(--border); border-left-width: 4px; border-radius: 10px; }
    .state.success { border-left-color: var(--success); } .state.success > nx-icon { color: var(--success); }
    .state.warning { border-left-color: var(--warning); background: var(--warning-50); } .state.warning > nx-icon { color: var(--warning); }
    .state.danger { border-left-color: var(--danger); background: var(--danger-50); } .state.danger > nx-icon { color: var(--danger); }
    .state > nx-icon { margin-top: 1px; flex-shrink: 0; }
    .icon-tile.success { background: var(--success-50); color: var(--success); }
    .icon-tile.warning { background: var(--warning-50); color: var(--warning); }
    .icon-tile.danger { background: var(--danger-50); color: var(--danger); }
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
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dlg');
  readonly agentId = input.required<string>();
  /** Muestra las acciones «Ayúdame» (solo si el Copilot está disponible para el usuario). */
  readonly copilot = input(true);
  readonly openTab = output<string>();
  readonly askCopilot = output<string>();
  readonly loaded = output<AgentHealth>();

  readonly severityOrder = SEVERITY_ORDER;
  readonly r = RADIUS;
  readonly circ = CIRC;
  readonly health = signal<AgentHealth | null>(null);
  readonly error = signal<string | null>(null);
  readonly modalOpen = signal(false);

  readonly levelLabel = computed(() => HEALTH_LEVEL_META[this.health()?.level ?? 'CRITICAL'].label);
  readonly ringTone = computed(() => RING_TONE[this.health()?.level ?? 'CRITICAL']);
  readonly offset = computed(() => CIRC * (1 - Math.max(0, Math.min(100, this.health()?.score ?? 0)) / 100));
  readonly publish = computed(() => PUBLISH_STATE_META[derivePublishState(this.health()?.checks ?? [])]);
  readonly counts = computed(() => countFindingsBySeverity(this.health()?.checks ?? []));
  readonly pending = computed(() => (this.health()?.checks ?? []).filter((c) => !c.passed));
  /** Hallazgos ordenados por severidad (bloqueantes primero); orden estable dentro de cada severidad. */
  readonly findings = computed(() =>
    [...this.pending()].sort((a, b) => HEALTH_SEVERITY_META[a.severity].rank - HEALTH_SEVERITY_META[b.severity].rank),
  );
  /** Resumen corto para la tarjeta compacta (p. ej. «1 bloqueante · 2 advertencias · 1 informativa»). */
  readonly summary = computed(() => {
    const c = this.counts();
    const parts = SEVERITY_ORDER.filter((s) => c[s]).map(
      (s) => `${c[s]} ${HEALTH_SEVERITY_META[s].label.toLowerCase()}${c[s] === 1 ? '' : 's'}`,
    );
    return parts.length ? parts.join(' · ') : 'Sin hallazgos pendientes';
  });

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
        this.close();
        void this.load();
      });
    });
  }

  async load() {
    this.error.set(null);
    try {
      const h = await this.api.health(this.agentId());
      this.health.set(h);
      this.loaded.emit(h);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  /** Abre el modal de detalle de la salud. */
  open() {
    this.modalOpen.set(true);
    this.dialog()?.nativeElement.showModal();
  }

  close() {
    if (this.modalOpen()) this.dialog()?.nativeElement.close();
    this.modalOpen.set(false);
  }

  onCancel(_ev: Event) {
    this.modalOpen.set(false);
  }

  /** Acción de un hallazgo: cierra el modal y navega a la sección del editor. */
  goToTab(tab: string) {
    this.close();
    this.openTab.emit(tab);
  }

  /** Acción de un hallazgo: cierra el modal y delega en el Copilot. */
  ask(prompt: string) {
    this.close();
    this.askCopilot.emit(prompt);
  }

  /** Abre el modal de salud y lleva el foco (enlace desde el Copilot). */
  reveal() {
    const el = this.host.nativeElement;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.open();
  }
}
