import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccessApi } from '../../core/access.api';
import {
  type AgentHealth,
  derivePublishState,
  HEALTH_SEVERITY_META,
  LAUNCH_MIN_HEALTH,
  type PublishState,
  PUBLISH_STATE_META,
  VISIBILITY_META,
} from '../../core/access.models';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { Agent } from '../../core/models';
import { TrainingApi } from '../../core/training.api';
import { DEFAULT_TARGET_SCORE, type TrainingSummary } from '../../core/training.models';
import { IconComponent } from '../../shared/icon.component';
import { ScorePipe } from '../../shared/score.pipe';
import { findingsOf, publishDependencies } from './agent-publish.util';

/** Extrae del error de la API la lista de requisitos incumplidos, si la incluye. */
function missingFrom(err: unknown): string[] {
  if (!(err instanceof HttpErrorResponse) || !err.error || typeof err.error !== 'object') return [];
  const body = err.error as Record<string, unknown>;
  const list = body['missing'] ?? body['reasons'] ?? body['requirements'];
  return Array.isArray(list) ? list.map((x) => (typeof x === 'string' ? x : String((x as { message?: string }).message ?? x))) : [];
}

/**
 * Lanzamiento con garantía de calidad (ADR 0006 D4): muestra los requisitos (salud ≥ 70 y última evaluación ≥ meta),
 * lanza y, si no se cumplen, permite a un ADMIN forzarlo con una razón obligatoria.
 */
@Component({
  selector: 'nx-agent-launch-dialog',
  imports: [FormsModule, IconComponent, ScorePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="modal" aria-labelledby="launch-title" (cancel)="onCancel($event)" (close)="closed.emit()">
      <form (ngSubmit)="submit()">
        <div class="modal-head">
          <div class="icon-tile"><nx-icon name="rocket" /></div>
          <div class="grow"><h2 id="launch-title">Publicar «{{ agent().name }}»</h2>
            <span class="small muted">Publicar lanza el agente: queda disponible por MCP, ejecuta rutinas y puede compartirse con toda la empresa. El chat de prueba no se ve afectado.</span></div>
        </div>
        <div class="modal-body">
          @if (psMeta(); as ps) {
            <div class="callout {{ ps.tone }}" role="status"><nx-icon [name]="ps.icon" [size]="16" />
              <div class="grow"><strong>{{ ps.label }}</strong><span class="block small">{{ ps.description }}</span></div></div>
          }

          <section class="pp">
            <h3 class="small muted">Qué se publicará</h3>
            <dl class="kv m0">
              <dt>Estado</dt><dd><span class="badge warning">Borrador</span><span class="arrow" aria-label="pasa a">→</span><span class="badge success">Lanzado</span></dd>
              <dt>Modelo</dt><dd>{{ agent().provider }} · {{ agent().model }}</dd>
              @if (agent().visibility; as v) { <dt>Disponibilidad</dt><dd>{{ visibilityMeta[v].label }}</dd> }
            </dl>
          </section>

          @if (dirty()) {
            <div class="callout warning" role="alert"><nx-icon name="alert" [size]="16" />
              <div class="grow"><strong>Hay cambios sin guardar</strong>
                <span class="block small">Se publicará la última versión guardada. Cancele, use «Guardar borrador» y vuelva a publicar para incluir sus cambios.</span></div></div>
          }

          <section class="pp">
            <h3 class="small muted">Dependencias en producción</h3>
            <ul class="deps">
              @for (d of deps(); track d.label) {
                <li><nx-icon [name]="d.icon" [size]="15" /><span class="grow">{{ d.label }}</span>
                  <span class="badge" [class.primary]="d.count > 0">{{ d.count }}</span></li>
              }
            </ul>
            @if (accounts().length) {
              <p class="small muted m0 chips"><nx-icon name="user" [size]="13" />Actúa sobre: @for (a of accounts(); track a) { <span class="chip">{{ a }}</span> }</p>
            }
            @if (kbNames().length) { <p class="small muted m0">Bases: {{ kbNames().join(' · ') }}</p> }
          </section>

          <section class="pp">
          <h3 class="small muted">Validaciones de calidad</h3>
          <ul class="reqs">
            <li [class.ok]="healthOk()" [class.ko]="healthOk() === false">
              <nx-icon [name]="healthOk() ? 'checkCircle' : healthOk() === false ? 'alert' : 'clock'" [size]="17" />
              <span>Puntaje de salud de al menos {{ minHealth }}
                <span class="block small muted">{{ health() ? 'Actual: ' + health()!.score + ' / 100' : 'Sin dato de salud' }}</span></span>
            </li>
            <li [class.ok]="evalOk()" [class.ko]="evalOk() === false">
              <nx-icon [name]="evalOk() ? 'checkCircle' : evalOk() === false ? 'alert' : 'clock'" [size]="17" />
              <span>Última evaluación igual o superior a la meta ({{ target() | score }})
                <span class="block small muted">
                  @if (summaryError()) { No se pudo consultar: {{ summaryError() }} }
                  @else if (!summary()) { Consultando evaluaciones… }
                  @else if (summary()!.latestScore === null) { Aún no hay evaluaciones: ejecútelas en la pestaña Entrenamiento. }
                  @else { Última: {{ summary()!.latestScore | score }} }
                </span></span>
            </li>
          </ul>
          @if (blockingFindings().length) {
            <div class="findings ko"><strong class="small"><nx-icon [name]="sevMeta.CRITICAL.icon" [size]="14" />Hallazgos bloqueantes</strong>
              <ul>@for (f of blockingFindings(); track f.id) { <li>{{ f.message }}<span class="block muted">{{ f.recommendation }}</span></li> }</ul></div>
          }
          @if (warningFindings().length) {
            <div class="findings warn"><strong class="small"><nx-icon [name]="sevMeta.WARNING.icon" [size]="14" />Advertencias</strong>
              <ul>@for (f of warningFindings(); track f.id) { <li>{{ f.message }}<span class="block muted">{{ f.recommendation }}</span></li> }</ul></div>
          }
          </section>

          @if (error()) {
            <div class="callout danger" role="alert"><nx-icon name="alert" [size]="16" />
              <div><span>{{ error() }}</span>
                @if (missing().length) { <ul class="miss">@for (m of missing(); track m) { <li>{{ m }}</li> }</ul> }</div></div>
          }

          @if (auth.isAdmin() && (blocked() || error())) {
            <div class="override">
              <label class="checkbox"><input type="checkbox" name="override" [(ngModel)]="override" />
                <strong>Forzar el lanzamiento como administrador</strong></label>
              @if (override) {
                <div class="field"><label for="launch-reason">Razón (obligatoria, queda registrada)</label>
                  <textarea id="launch-reason" class="input" name="reason" rows="3" required [(ngModel)]="reason"
                    placeholder="Ej.: piloto controlado con el equipo de operaciones durante dos semanas"></textarea></div>
              }
            </div>
          } @else if (blocked()) {
            <p class="muted small m0">Complete los requisitos o pida a un administrador que fuerce el lanzamiento.</p>
          }
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" (click)="close()">Cancelar</button>
          <button type="submit" class="btn primary" [disabled]="busy() || (override && reason.trim().length < 5)">
            <nx-icon name="rocket" [size]="16" />{{ busy() ? 'Publicando…' : override ? 'Forzar publicación' : 'Publicar' }}</button>
        </div>
      </form>
    </dialog>
  `,
  styles: `
    .grow { flex: 1; min-width: 0; }
    .m0 { margin: 0; }
    .block { display: block; }
    .modal-body { display: flex; flex-direction: column; gap: 14px; }
    .callout.success { background: var(--success-50); border-color: var(--success); }
    .callout.success nx-icon, .callout.success strong { color: var(--success); }
    .pp { display: flex; flex-direction: column; gap: 8px; }
    .pp > h3 { margin: 0; }
    .kv { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; align-items: center; }
    .kv dt { font-size: 12.5px; color: var(--muted); font-weight: 600; }
    .kv dd { margin: 0; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .arrow { color: var(--muted); }
    .deps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .deps li { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 1px solid var(--border); border-radius: 9px; font-size: 13px; }
    .deps li nx-icon { color: var(--muted); }
    .chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .chip { background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; padding: 1px 9px; color: var(--text); font-weight: 550; }
    .reqs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .reqs li { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; }
    .reqs li nx-icon { color: var(--muted); margin-top: 1px; }
    .reqs li.ok nx-icon { color: var(--success); }
    .reqs li.ko { border-color: var(--warning); background: var(--warning-50); }
    .reqs li.ko nx-icon { color: var(--warning); }
    .findings { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
    .findings.ko { border-color: var(--danger); background: var(--danger-50); }
    .findings.warn { border-color: var(--warning); background: var(--warning-50); }
    .findings > strong { display: inline-flex; align-items: center; gap: 6px; }
    .findings.ko > strong { color: var(--danger); }
    .findings.warn > strong { color: var(--warning); }
    .findings ul { margin: 6px 0 0; padding-left: 18px; font-size: 12.5px; }
    .findings li { margin: 3px 0; }
    .findings li .block { font-weight: 400; }
    .miss { margin: 6px 0 0; padding-left: 18px; font-weight: 500; }
    .override { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px dashed var(--warning); border-radius: 10px; }
  `,
})
export class AgentLaunchDialogComponent implements OnInit {
  private readonly api = inject(AccessApi);
  private readonly training = inject(TrainingApi);
  protected readonly auth = inject(AuthService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  readonly agent = input.required<Agent>();
  readonly health = input<AgentHealth | null>(null);
  /** Hay cambios sin guardar en el editor: se publica la versión guardada (aviso de pre-publicación). */
  readonly dirty = input(false);
  /** Cuentas (buzones/identidades) sobre las que actuará el agente; se muestran en las dependencias. */
  readonly accounts = input<string[]>([]);
  readonly launched = output<Agent>();
  readonly closed = output<void>();

  readonly minHealth = LAUNCH_MIN_HEALTH;
  readonly visibilityMeta = VISIBILITY_META;
  readonly sevMeta = HEALTH_SEVERITY_META;

  /** Estado de publicación derivado de los hallazgos de salud (informativo; el gate real es el backend). */
  readonly publishState = computed<PublishState | null>(() => {
    const h = this.health();
    return h ? derivePublishState(h.checks) : null;
  });
  readonly psMeta = computed(() => {
    const s = this.publishState();
    return s ? PUBLISH_STATE_META[s] : null;
  });
  readonly blockingFindings = computed(() => findingsOf(this.health()?.checks ?? [], 'CRITICAL'));
  readonly warningFindings = computed(() => findingsOf(this.health()?.checks ?? [], 'WARNING'));
  readonly deps = computed(() => publishDependencies(this.agent()));
  readonly kbNames = computed(() => (this.agent().knowledgeBases ?? []).map((k) => k.name));
  readonly summary = signal<TrainingSummary | null>(null);
  readonly summaryError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly missing = signal<string[]>([]);
  override = false;
  reason = '';

  readonly target = computed(() => this.summary()?.targetScore ?? this.agent().targetScore ?? DEFAULT_TARGET_SCORE);
  readonly healthOk = computed(() => (this.health() ? this.health()!.score >= LAUNCH_MIN_HEALTH : null));
  readonly evalOk = computed(() => {
    const s = this.summary();
    if (!s) return null;
    return s.latestScore !== null && s.latestScore >= this.target();
  });
  readonly blocked = computed(() => this.healthOk() === false || this.evalOk() === false);

  constructor() {
    afterNextRender(() => this.dialog().nativeElement.showModal());
  }

  async ngOnInit() {
    try {
      this.summary.set(await this.training.summary(this.agent().id));
    } catch (e) {
      this.summaryError.set(errorMessage(e));
    }
  }

  onCancel(ev: Event) {
    if (this.busy()) ev.preventDefault();
  }

  close() {
    if (!this.busy()) this.dialog().nativeElement.close();
  }

  async submit() {
    if (this.busy()) return;
    if (this.override && this.reason.trim().length < 5) return;
    this.busy.set(true);
    this.error.set(null);
    this.missing.set([]);
    try {
      const agent = await this.api.launch(this.agent().id, this.override ? { override: true, reason: this.reason.trim() } : {});
      this.busy.set(false);
      this.launched.emit(agent);
      this.dialog().nativeElement.close();
    } catch (e) {
      this.error.set(errorMessage(e));
      this.missing.set(missingFrom(e));
      this.busy.set(false);
    }
  }
}
