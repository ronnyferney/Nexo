import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent } from '../../layout/page-header.component';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { AccessApi } from '../../core/access.api';
import type { AgentHealthSummary } from '../../core/access.models';
import type { Execution, MyUsage, Stats } from '../../core/models';
import { budgetLevel, periodLabel, POLICY_LABELS } from '../../shared/budget';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { ProgressBarComponent } from '../../shared/progress-bar.component';
import { StatusBadgeComponent } from '../../shared/status-badge.component';
import { NumberPipe, UsdPipe } from '../../shared/usd.pipe';
import { buildKpis, DEFAULT_RANGE, parseRange, RANGE_OPTIONS, type DashboardRange } from './dashboard.util';

/** Clave por-visor para recordar si «Primeros pasos» está colapsado. */
const STEPS_KEY = 'nx.dashboard.stepsHidden';

/** Pasos de la guía de inicio (estáticos): icono, título, descripción y acción. */
const STEPS = [
  { icon: 'plug', title: 'Conecta tus sistemas', desc: 'Crea un conector REST, SOAP, GraphQL o MCP e importa sus operaciones.', cta: 'Conectar', link: '/connectors' },
  { icon: 'bot', title: 'Crea un agente', desc: 'Define instrucciones, modelo y herramientas conectadas a tus sistemas.', cta: 'Crear agente', link: '/agents/new' },
  { icon: 'flow', title: 'Diseña un flujo', desc: 'Combina conectores, condiciones y agentes en una automatización.', cta: 'Diseñar flujo', link: '/workflows' },
  { icon: 'zap', title: 'Actívalo', desc: 'Dispara por webhook o cron, o exponlo como servidor MCP.', cta: 'Activar', link: '/workflows' },
] as const;

@Component({
  selector: 'nx-dashboard',
  imports: [RouterLink, PageHeaderComponent, IconComponent, StatusBadgeComponent, RelativeTimePipe, ProgressBarComponent, UsdPipe, NumberPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nx-page-header hostClass="brand-hero" [heading]="greeting()"
        description="Aquí tienes el estado de tu plataforma de agentes y automatización.">
        <label actions class="range">
          <span class="range-label">Periodo</span>
          <select class="input" [value]="range()" (change)="onRange($event)" aria-label="Rango de tiempo del resumen">
            @for (o of rangeOptions; track o.value) {
              <option [value]="o.value">{{ o.label }}</option>
            }
          </select>
        </label>
      </nx-page-header>

      @if (critical().length) {
        <div class="callout danger crit" role="alert">
          <nx-icon name="heartPulse" [size]="18" />
          <div class="grow">
            <strong>{{ critical().length === 1 ? 'Un agente necesita atención urgente' : critical().length + ' agentes necesitan atención urgente' }}</strong>
            <p>Su puntaje de salud es crítico: revise las recomendaciones o pida ayuda a Nexo Copilot.</p>
            <ul class="crit-list">
              @for (h of critical().slice(0, 5); track h.agentId) {
                <li><a [routerLink]="['/agents', h.agentId]">{{ h.name }}</a><span class="score">{{ h.score }} / 100</span></li>
              }
            </ul>
            @if (critical().length > 5) { <a routerLink="/agents" class="small">Ver los {{ critical().length }} agentes</a> }
          </div>
        </div>
      }

      <section class="assistant" aria-label="Accesos rápidos">
        <div class="assistant-head"><nx-icon name="sparkles" [size]="16" /><span>Asistente personal</span></div>
        <div class="ac-grid">
          <a class="ac-card" routerLink="/trabajo">
            <div class="ac-ico work"><nx-icon name="checkCircle" [size]="20" /></div>
            <strong>Mi trabajo</strong>
            <span class="muted small">Objetivos, tareas y resultados al día.</span>
          </a>
          <a class="ac-card" routerLink="/aprobaciones">
            <div class="ac-ico appr"><nx-icon name="thumbsUp" [size]="20" /></div>
            <strong>Aprobaciones</strong>
            <span class="muted small">Revisa y autoriza lo que está pendiente.</span>
          </a>
          <a class="ac-card" routerLink="/agents">
            <div class="ac-ico agents"><nx-icon name="bot" [size]="20" /></div>
            <strong>Empleados digitales</strong>
            <span class="muted small">Crea, gobierna y sigue a tus agentes.</span>
          </a>
        </div>
      </section>

      <section class="grid grid-4" aria-label="Resumen de la plataforma">
        @for (k of kpis(); track k.label) {
          <a class="card hover kpi" [routerLink]="k.link">
            <div class="icon-tile"><nx-icon [name]="k.icon" /></div>
            <div class="kpi-body">
              <div class="muted small">{{ k.label }}</div>
              <div class="value">{{ k.value }}</div>
              <div class="muted small sub">{{ k.subline }}</div>
            </div>
          </a>
        }
      </section>

      <div class="main-grid">
        <div class="col">
          <!-- Hero del cuerpo: invitación a crear agentes -->
          <section class="card hero" aria-labelledby="hero-title">
            <div class="hero-text">
              <h2 id="hero-title">Crea, conecta y automatiza con agentes de IA</h2>
              <p>Construye agentes con instrucciones, modelo y herramientas conectadas a tus sistemas.</p>
              <div class="row wrap">
                <a routerLink="/agents/new" class="btn primary"><nx-icon name="plus" [size]="16" />Crear agente</a>
                <a routerLink="/agents" class="btn"><nx-icon name="search" [size]="16" />Explorar agentes</a>
              </div>
            </div>
            <svg class="hero-art" viewBox="0 0 120 96" fill="none" aria-hidden="true">
              <rect x="6" y="34" width="34" height="28" rx="6" stroke="currentColor" stroke-width="2" />
              <circle cx="17" cy="48" r="2.4" fill="currentColor" />
              <circle cx="29" cy="48" r="2.4" fill="currentColor" />
              <path d="M23 34v-8M15 26h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              <path d="M40 48h22a8 8 0 0 1 8 8v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 5" />
              <rect x="80" y="12" width="30" height="22" rx="6" stroke="currentColor" stroke-width="2" />
              <rect x="80" y="54" width="30" height="22" rx="6" stroke="currentColor" stroke-width="2" />
              <path d="M70 62h10M70 23h10M80 62v-6a8 8 0 0 1 0-16" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              <path d="M95 22l2.3 4.7 5.2.8-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1-3.8-3.6 5.2-.8z" fill="currentColor" opacity="0.6" />
            </svg>
          </section>

          <!-- Primeros pasos (colapsable, persistido por-visor) -->
          <section class="card">
            <div class="card-title">
              <h2>Primeros pasos</h2>
              <span class="spacer"></span>
              <button type="button" class="btn ghost sm" (click)="toggleSteps()" [attr.aria-expanded]="!stepsHidden()">
                {{ stepsHidden() ? 'Mostrar' : 'Ocultar' }}
              </button>
            </div>
            @if (!stepsHidden()) {
              <ol class="steps">
                @for (s of steps; track s.title; let i = $index) {
                  <li class="step">
                    <span class="step-num" aria-hidden="true">{{ i + 1 }}</span>
                    <div class="icon-tile sm"><nx-icon [name]="s.icon" [size]="16" /></div>
                    <div class="step-body">
                      <strong>{{ s.title }}</strong>
                      <p class="muted small">{{ s.desc }}</p>
                    </div>
                    <a [routerLink]="s.link" class="btn sm">{{ s.cta }}</a>
                  </li>
                }
              </ol>
            }
          </section>
        </div>

        <div class="col">
          <!-- Ejecuciones recientes -->
          <section class="card">
            <div class="card-title"><h2>Ejecuciones recientes</h2><span class="spacer"></span><a routerLink="/executions" class="small">Ver todas</a></div>
            @if (executions().length) {
              <ul class="runs">
                @for (e of executions(); track e.id) {
                  <li>
                    <a class="run" [routerLink]="['/executions', e.id]">
                      <span class="run-name">{{ e.workflow?.name || 'Ejecución' }}</span>
                      <nx-status [status]="e.status" />
                      <span class="muted small run-time">{{ e.createdAt | ago }}</span>
                      <nx-icon name="arrowLeft" [size]="15" class="go" />
                    </a>
                  </li>
                }
              </ul>
            } @else {
              <div class="empty"><p>Aún no hay ejecuciones.</p></div>
            }
          </section>

          <!-- Uso y consumo -->
          <section class="card">
            <div class="card-title"><h2>Uso y consumo</h2><span class="spacer"></span><a routerLink="/my-usage" class="small">Ver detalles</a></div>
            @if (usage(); as u) {
              <div class="usage">
                <div class="usage-row">
                  <span class="muted small">Presupuesto</span>
                  @if (u.budgets[0]; as b) {
                    <div class="usage-budget">
                      <div class="row wrap small">
                        <span class="muted">{{ b.orgUnitName }} · {{ periodLabel(b.period) }} {{ b.periodKey }}</span>
                        <span class="spacer"></span>
                        <span class="badge">{{ policyLabels[b.policy] }}</span>
                        <span class="pct {{ level(b.pct) }}">{{ b.pct | num: 1 }} %</span>
                      </div>
                      <nx-progress [pct]="b.pct" label="Consumo del presupuesto" />
                      <span class="muted small">{{ b.spentUsd | usd }} de {{ b.limitUsd | usd }}</span>
                    </div>
                  } @else {
                    <div class="row wrap small">
                      <span>Sin presupuesto definido</span>
                      <span class="spacer"></span>
                      @if (auth.isAdmin()) {
                        <a routerLink="/admin/budgets" class="btn sm">Configurar</a>
                      }
                    </div>
                  }
                </div>
                <div class="usage-row inline">
                  <span class="muted small">Consumo este mes</span>
                  <span class="spacer"></span>
                  <strong class="spend">{{ u.me.costUsd | usd }}</strong>
                </div>
                <p class="muted small chart-note">
                  El desglose diario del consumo está disponible en <a routerLink="/my-usage">Ver detalles</a>.
                </p>
              </div>
            } @else {
              <div class="empty"><p>Sin datos de consumo disponibles.</p></div>
            }
          </section>
        </div>
      </div>
    </div>
  `,
  styles: `
    .range { display: inline-flex; align-items: center; gap: 8px; }
    .range-label { font-size: 12.5px; font-weight: 600; color: var(--muted); }
    .range select.input { width: auto; }

    .kpi { display: flex; gap: 14px; align-items: flex-start; color: inherit; }
    .kpi-body { min-width: 0; }
    .value { font-size: 26px; font-weight: 700; line-height: 1.2; }
    .sub { margin-top: 2px; }

    .main-grid { display: grid; grid-template-columns: 1.7fr 1fr; gap: 16px; margin-top: 16px; }
    .col { display: grid; gap: 16px; align-content: start; }
    @media (max-width: 900px) { .main-grid { grid-template-columns: 1fr; } }

    .hero { display: flex; gap: 16px; align-items: center; overflow: hidden; }
    .hero-text { flex: 1; min-width: 0; display: grid; gap: 10px; }
    .hero-text h2 { margin: 0; }
    .hero-text p { margin: 0; color: var(--muted); max-width: 46ch; }
    .hero-art { width: 120px; height: 96px; flex-shrink: 0; color: var(--primary); }
    @media (max-width: 480px) { .hero-art { display: none; } }

    .steps { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
    .step { display: flex; gap: 12px; align-items: center; }
    .step-num { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--muted); width: 16px; text-align: center; flex-shrink: 0; }
    .icon-tile.sm { width: 30px; height: 30px; border-radius: 8px; }
    .step-body { flex: 1; min-width: 0; }
    .step-body p { margin: 2px 0 0; }
    .step .btn { flex-shrink: 0; }

    .runs { list-style: none; margin: 0; padding: 0; display: grid; }
    .run { display: flex; align-items: center; gap: 10px; padding: 10px 6px; border-radius: 8px; color: inherit; border-top: 1px solid var(--border); }
    .runs li:first-child .run { border-top: 0; }
    .run:hover { background: var(--surface-2); }
    .run-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 550; }
    .run-time { flex-shrink: 0; }
    .go { transform: rotate(180deg); color: var(--muted); flex-shrink: 0; }

    .usage { display: grid; gap: 14px; }
    .usage-row { display: grid; gap: 6px; }
    .usage-row.inline { grid-auto-flow: column; align-items: center; }
    .usage-budget { display: grid; gap: 6px; }
    .spend { font-size: 18px; }
    .pct.warn { color: var(--warning); }
    .pct.danger, .pct.over { color: var(--danger); }
    .chart-note { margin: 0; }

    /* Asistente personal: fila de tarjetas de acceso rápido (estilo home moderno). */
    .assistant { margin-bottom: 18px; }
    .assistant-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-weight: 700; color: var(--text); }
    .assistant-head nx-icon { color: var(--brand-cyan, #16C7F4); }
    .ac-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .ac-card { display: flex; flex-direction: column; gap: 6px; padding: 16px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border); transition: border-color 0.14s, transform 0.14s, box-shadow 0.14s; }
    .ac-card:hover { border-color: var(--brand-cyan, #16C7F4); transform: translateY(-2px); box-shadow: 0 10px 28px rgba(18, 91, 234, 0.12); }
    .ac-card strong { color: var(--text); font-size: 15px; }
    .ac-ico { width: 40px; height: 40px; border-radius: 11px; display: grid; place-items: center; margin-bottom: 4px; color: #fff; }
    .ac-ico.work { background: linear-gradient(135deg, #125BEA, #16C7F4); }
    .ac-ico.appr { background: linear-gradient(135deg, #16C7F4, #8550E9); }
    .ac-ico.agents { background: linear-gradient(135deg, #8550E9, #125BEA); }
    @media (max-width: 760px) { .ac-grid { grid-template-columns: 1fr; } }
    .crit { margin-bottom: 16px; }
    .crit p { margin: 2px 0 6px; font-weight: 450; }
    .crit .grow { flex: 1; min-width: 0; }
    .crit-list { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px 16px; }
    .crit-list li { display: inline-flex; gap: 6px; align-items: baseline; }
    .crit-list a { font-weight: 650; color: var(--danger); text-decoration: underline; }
    .crit .score { font-size: 12px; font-variant-numeric: tabular-nums; }
  `,
})
export class DashboardPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly access = inject(AccessApi);
  protected readonly auth = inject(AuthService);
  /** Saludo dinámico del encabezado «hero»: según la hora del día, con el nombre de pila y el emoji. */
  readonly greeting = computed(() => {
    const me = this.auth.me();
    const h = new Date().getHours();
    const saludo = h < 6 ? 'Buenas noches' : h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
    const emoji = h < 6 || h >= 19 ? '🌙' : '☀️';
    const nombre = me ? ', ' + me.name.split(' ')[0] : '';
    return `${saludo}${nombre} ${emoji}`;
  });
  readonly critical = signal<AgentHealthSummary[]>([]);
  readonly steps = STEPS;
  readonly rangeOptions = RANGE_OPTIONS;
  readonly stats = signal<Stats | null>(null);
  readonly executions = signal<Execution[]>([]);
  readonly usage = signal<MyUsage | null>(null);
  readonly range = signal<DashboardRange>(this.readRange());
  readonly stepsHidden = signal<boolean>(this.readStepsHidden());
  readonly kpis = computed(() => buildKpis(this.stats()));
  readonly policyLabels = POLICY_LABELS;
  readonly periodLabel = periodLabel;
  readonly level = budgetLevel;

  /** Cambia el rango y lo recuerda. Hoy las métricas (`Stats`) no dependen del rango; queda listo para cuando lo hagan. */
  onRange(event: Event) {
    const value = parseRange((event.target as HTMLSelectElement).value);
    this.range.set(value);
    try {
      localStorage.setItem('nx.dashboard.range', value);
    } catch {
      // almacenamiento no disponible: la preferencia solo dura esta sesión
    }
  }

  toggleSteps() {
    const hidden = !this.stepsHidden();
    this.stepsHidden.set(hidden);
    try {
      localStorage.setItem(STEPS_KEY, hidden ? '1' : '0');
    } catch {
      // almacenamiento no disponible: no se recuerda entre recargas
    }
  }

  private readRange(): DashboardRange {
    try {
      return parseRange(localStorage.getItem('nx.dashboard.range'));
    } catch {
      return DEFAULT_RANGE;
    }
  }

  private readStepsHidden(): boolean {
    try {
      return localStorage.getItem(STEPS_KEY) === '1';
    } catch {
      return false;
    }
  }

  async ngOnInit() {
    // El consumo es complementario: si falla no debe impedir mostrar el resto del inicio.
    this.api.myUsage().then((u) => this.usage.set(u), () => this.usage.set(null));
    // Alertas de salud (ADR 0006 D5): complementarias, sin bloquear el inicio.
    this.access.healthSummary().then(
      (list) => this.critical.set(list.filter((h) => h.level === 'CRITICAL').sort((a, b) => a.score - b.score)),
      () => this.critical.set([]),
    );
    const [stats, ex] = await Promise.all([this.api.stats(), this.api.executions({ take: '6' })]);
    this.stats.set(stats);
    this.executions.set(ex.items);
  }
}
