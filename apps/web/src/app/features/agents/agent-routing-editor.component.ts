import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { RoutingObjective, RoutingPolicy, RoutingRule, RoutingSpecialty, RoutingTier } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';
import { TIER_LABELS } from '../../shared/budget';
import {
  clampMaxCandidates,
  DEFAULT_MAX_CANDIDATES,
  defaultRoutingPolicy,
  MAX_CANDIDATES,
  MIN_CANDIDATES,
  OBJECTIVE_HINTS,
  OBJECTIVE_LABELS,
  ROUTING_OBJECTIVES,
  ROUTING_PRESETS,
  ROUTING_SPECIALTIES,
  ROUTING_TIERS,
  routingPreset,
  SPECIALTY_LABELS,
  type RoutingPresetId,
} from './agent-routing.util';

/**
 * Editor de la política de enrutamiento multi-modelo por agente (ADR 0010, Fase 5).
 * Desactivado ⇒ `routing = null` (comportamiento actual: principal + respaldos). Presets + modo avanzado.
 * NO edita la verificación cruzada (`verify`, Fase 3): se preserva tal cual venga del servidor.
 */
@Component({
  selector: 'nx-agent-routing-editor',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card stack">
      <div class="row wrap head">
        <nx-icon name="branch" [size]="16" />
        <strong>Enrutamiento multi-modelo</strong>
        @if (enabled()) {
          <span class="badge ok">Activo</span>
        } @else {
          <span class="badge">Desactivado</span>
        }
        <span class="spacer"></span>
        <label class="switch" [class.off]="!canEdit()">
          <input
            type="checkbox"
            [checked]="enabled()"
            [disabled]="!canEdit()"
            (change)="toggle($any($event.target).checked)"
            aria-label="Activar enrutamiento multi-modelo"
          />
          <span>{{ enabled() ? 'Activado' : 'Activar' }}</span>
        </label>
      </div>

      <p class="muted small m0">
        Elige el mejor modelo del catálogo para cada tarea según su capacidad y tu objetivo de costo o calidad, siempre
        dentro de los modelos y presupuestos que permite tu empresa. Desactivado, el agente usa su modelo principal y la
        cadena de respaldo, igual que hoy.
      </p>

      @if (enabled()) {
        <div class="stack">
          <div>
            <span class="lbl">Presets</span>
            <div class="presets">
              @for (p of presets; track p.id) {
                <button
                  type="button"
                  class="preset"
                  [class.active]="activePreset() === p.id"
                  [attr.aria-pressed]="activePreset() === p.id"
                  [disabled]="!canEdit()"
                  (click)="applyPreset(p.id)"
                >
                  <div class="icon-tile"><nx-icon [name]="p.icon" [size]="16" /></div>
                  <div>
                    <strong>{{ p.label }}</strong>
                    <div class="muted small">{{ p.description }}</div>
                  </div>
                </button>
              }
            </div>
          </div>

          <div class="summary">
            <nx-icon name="info" [size]="14" />
            <span class="small">
              Objetivo: <strong>{{ objectiveLabels[policyOrDefault().objective] }}</strong> ·
              {{ ruleCount() }} {{ ruleCount() === 1 ? 'regla' : 'reglas' }} · hasta
              <strong>{{ policyOrDefault().maxCandidates ?? defaultMax }}</strong>
              {{ (policyOrDefault().maxCandidates ?? defaultMax) === 1 ? 'intento' : 'intentos' }} por tarea
            </span>
          </div>

          <details class="advanced" [open]="advancedOpen()">
            <summary (click)="toggleAdvanced($event)">
              <nx-icon [name]="advancedOpen() ? 'chevronDown' : 'chevronUp'" [size]="15" />
              Modo avanzado
            </summary>

            <div class="stack adv-body">
              <div class="grid grid-2">
                <div class="field">
                  <label for="rt-objective">Objetivo</label>
                  <select
                    id="rt-objective"
                    class="input"
                    [disabled]="!canEdit()"
                    [ngModel]="policyOrDefault().objective"
                    (ngModelChange)="setObjective($event)"
                  >
                    @for (o of objectives; track o) {
                      <option [value]="o">{{ objectiveLabels[o] }}</option>
                    }
                  </select>
                  <span class="hint">{{ objectiveHints[policyOrDefault().objective] }}</span>
                </div>
                <div class="field">
                  <label for="rt-max">Máx. intentos por tarea</label>
                  <input
                    id="rt-max"
                    class="input"
                    type="number"
                    [min]="minCandidates"
                    [max]="maxCandidates"
                    [disabled]="!canEdit()"
                    [ngModel]="policyOrDefault().maxCandidates ?? defaultMax"
                    (ngModelChange)="setMaxCandidates($event)"
                  />
                  <span class="hint">Incluye respaldos. La mayoría de las tareas resuelve con el primero.</span>
                </div>
              </div>

              <div>
                <div class="row wrap">
                  <span class="lbl">Reglas de preferencia</span>
                  <span class="muted small">Se evalúan en orden; la primera cuyo «cuándo» encaja, gana.</span>
                </div>
                <ol class="rules">
                  @for (rule of policyOrDefault().rules ?? []; track $index; let i = $index) {
                    <li class="rule">
                      <div class="rule-head">
                        <span class="pos">{{ i + 1 }}</span>
                        @if (canEdit()) {
                          <button
                            class="btn ghost icon sm"
                            type="button"
                            title="Subir"
                            aria-label="Subir prioridad de la regla"
                            [disabled]="i === 0"
                            (click)="moveRule(i, -1)"
                          >
                            <nx-icon name="chevronUp" [size]="15" />
                          </button>
                          <button
                            class="btn ghost icon sm"
                            type="button"
                            title="Bajar"
                            aria-label="Bajar prioridad de la regla"
                            [disabled]="i === (policyOrDefault().rules?.length ?? 0) - 1"
                            (click)="moveRule(i, 1)"
                          >
                            <nx-icon name="chevronDown" [size]="15" />
                          </button>
                          <span class="spacer"></span>
                          <button
                            class="btn ghost icon sm danger"
                            type="button"
                            title="Quitar regla"
                            aria-label="Quitar regla"
                            (click)="removeRule(i)"
                          >
                            <nx-icon name="x" [size]="15" />
                          </button>
                        }
                      </div>

                      <fieldset class="rule-group">
                        <legend>Cuándo aplica</legend>
                        <div class="grid grid-3">
                          <div class="field">
                            <label [attr.for]="'rt-cap-' + i">Capacidad requerida</label>
                            <select
                              [id]="'rt-cap-' + i"
                              class="input"
                              [disabled]="!canEdit()"
                              [ngModel]="rule.when.capability ?? ''"
                              (ngModelChange)="setWhenCapability(i, $event)"
                            >
                              <option value="">Cualquiera</option>
                              @for (s of specialties; track s) {
                                <option [value]="s">{{ specialtyLabels[s] }}</option>
                              }
                            </select>
                          </div>
                          <div class="field">
                            <label [attr.for]="'rt-ctx-' + i">Contexto mínimo (tokens)</label>
                            <input
                              [id]="'rt-ctx-' + i"
                              class="input"
                              type="number"
                              min="1"
                              placeholder="Sin mínimo"
                              [disabled]="!canEdit()"
                              [ngModel]="rule.when.minContextTokens ?? null"
                              (ngModelChange)="setWhenContext(i, $event)"
                            />
                          </div>
                          <div class="field check">
                            <label class="chk">
                              <input
                                type="checkbox"
                                [disabled]="!canEdit()"
                                [checked]="!!rule.when.hasImages"
                                (change)="setWhenImages(i, $any($event.target).checked)"
                              />
                              La entrada trae imágenes
                            </label>
                          </div>
                        </div>
                      </fieldset>

                      <fieldset class="rule-group">
                        <legend>Preferir</legend>
                        <div class="field">
                          <span class="sub">Especialidades</span>
                          <div class="chips">
                            @for (s of specialties; track s) {
                              <label class="chip" [class.on]="hasSpecialty(rule, s)">
                                <input
                                  type="checkbox"
                                  [disabled]="!canEdit()"
                                  [checked]="hasSpecialty(rule, s)"
                                  (change)="toggleSpecialty(i, s, $any($event.target).checked)"
                                />
                                {{ specialtyLabels[s] }}
                              </label>
                            }
                          </div>
                        </div>
                        <div class="field">
                          <label [attr.for]="'rt-tier-' + i">Nivel preferido</label>
                          <select
                            [id]="'rt-tier-' + i"
                            class="input"
                            [disabled]="!canEdit()"
                            [ngModel]="rule.prefer.tier ?? ''"
                            (ngModelChange)="setTier(i, $event)"
                          >
                            <option value="">Sin preferencia</option>
                            @for (t of tiers; track t) {
                              <option [value]="t">{{ tierLabels[t] }}</option>
                            }
                          </select>
                        </div>
                        @if (rule.prefer.models?.length) {
                          <div class="field">
                            <span class="sub">Modelos preferidos</span>
                            <div class="models">
                              @for (m of rule.prefer.models ?? []; track m; let j = $index) {
                                <span class="badge model">
                                  <code>{{ m }}</code>
                                  @if (canEdit()) {
                                    <button
                                      type="button"
                                      class="rm"
                                      title="Quitar modelo"
                                      [attr.aria-label]="'Quitar modelo ' + m"
                                      (click)="removeModel(i, j)"
                                    >
                                      <nx-icon name="x" [size]="12" />
                                    </button>
                                  }
                                </span>
                              }
                            </div>
                            <span class="hint">Definidos por un preset o por la API; se conservan al guardar.</span>
                          </div>
                        }
                      </fieldset>
                    </li>
                  } @empty {
                    <li class="muted small">Sin reglas: todos los candidatos se ordenan solo por el objetivo.</li>
                  }
                </ol>
                @if (canEdit()) {
                  <button type="button" class="btn" (click)="addRule()">
                    <nx-icon name="plus" [size]="15" />Agregar regla
                  </button>
                }
              </div>
            </div>
          </details>
        </div>
      }
    </div>
  `,
  styles: `
    .m0 { margin: 0; }
    .head { align-items: center; }
    .badge.ok { background: color-mix(in srgb, var(--success) 18%, transparent); color: var(--success); }
    .lbl { display: block; font-size: 12.5px; font-weight: 600; color: var(--muted); margin-bottom: 6px; }
    .sub { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
    .switch { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px; font-weight: 600; }
    .switch.off { cursor: not-allowed; opacity: 0.7; }
    .presets { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
    .preset { display: flex; gap: 10px; align-items: flex-start; text-align: left; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: inherit; font: inherit; cursor: pointer; }
    .preset:hover:not(:disabled) { border-color: var(--primary); }
    .preset.active { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary) inset; }
    .preset:disabled { cursor: not-allowed; opacity: 0.6; }
    .icon-tile { display: inline-flex; padding: 6px; border-radius: 8px; background: color-mix(in srgb, var(--primary) 12%, transparent); color: var(--primary); }
    .summary { display: flex; align-items: center; gap: 6px; color: var(--muted); }
    .advanced { border: 1px solid var(--border); border-radius: 10px; }
    .advanced > summary { display: flex; align-items: center; gap: 6px; padding: 10px 12px; cursor: pointer; font-weight: 600; font-size: 13px; list-style: none; }
    .advanced > summary::-webkit-details-marker { display: none; }
    .adv-body { padding: 0 12px 12px; }
    .rules { list-style: none; margin: 8px 0; padding: 0; display: grid; gap: 10px; }
    .rule { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; display: grid; gap: 10px; }
    .rule-head { display: flex; align-items: center; gap: 6px; }
    .pos { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; border-radius: 6px; background: var(--surface-2, var(--border)); font-size: 12px; font-weight: 700; }
    .rule-group { border: 1px solid var(--border); border-radius: 8px; padding: 10px; margin: 0; }
    .rule-group legend { padding: 0 6px; font-size: 12px; font-weight: 600; color: var(--muted); }
    .field.check { display: flex; align-items: flex-end; }
    .chk, .chip { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
    .chk { font-size: 13px; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip { padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px; font-size: 12.5px; }
    .chip.on { border-color: var(--primary); color: var(--primary); }
    .models { display: flex; flex-wrap: wrap; gap: 6px; }
    .badge.model { display: inline-flex; align-items: center; gap: 4px; }
    .rm { display: inline-flex; border: none; background: none; color: inherit; cursor: pointer; padding: 0; }
    .spacer { flex: 1; }
  `,
})
export class AgentRoutingEditorComponent {
  /** Política ligada al detalle del agente; `null` = enrutamiento desactivado. */
  readonly policy = model.required<RoutingPolicy | null>();
  readonly canEdit = input(false);

  readonly presets = ROUTING_PRESETS;
  readonly objectives = ROUTING_OBJECTIVES;
  readonly specialties = ROUTING_SPECIALTIES;
  readonly tiers = ROUTING_TIERS;
  readonly objectiveLabels = OBJECTIVE_LABELS;
  readonly objectiveHints = OBJECTIVE_HINTS;
  readonly specialtyLabels = SPECIALTY_LABELS;
  readonly tierLabels = TIER_LABELS;
  readonly minCandidates = MIN_CANDIDATES;
  readonly maxCandidates = MAX_CANDIDATES;
  readonly defaultMax = DEFAULT_MAX_CANDIDATES;

  /** Preset elegido en esta sesión para resaltarlo; se borra al editar a mano. */
  private readonly presetRef = signal<RoutingPresetId | null>(null);
  private readonly advanced = signal(false);

  readonly enabled = computed(() => this.policy() !== null);
  readonly activePreset = computed(() => this.presetRef());
  readonly advancedOpen = computed(() => this.advanced());
  /** Política vigente, o la base por defecto para pintar el formulario cuando aún no hay una. */
  readonly policyOrDefault = computed<RoutingPolicy>(() => this.policy() ?? defaultRoutingPolicy());
  readonly ruleCount = computed(() => this.policyOrDefault().rules?.length ?? 0);

  toggle(on: boolean): void {
    if (!this.canEdit()) return;
    if (on) {
      this.presetRef.set('balanced');
      this.policy.set(routingPreset('balanced'));
    } else {
      this.presetRef.set(null);
      this.policy.set(null);
    }
  }

  toggleAdvanced(ev: Event): void {
    ev.preventDefault();
    this.advanced.update((v) => !v);
  }

  applyPreset(id: RoutingPresetId): void {
    if (!this.canEdit()) return;
    this.presetRef.set(id);
    this.policy.set(routingPreset(id));
  }

  // ----- Edición manual (modo avanzado): cada cambio borra el preset resaltado -----

  private update(mutate: (p: RoutingPolicy) => RoutingPolicy): void {
    if (!this.canEdit()) return;
    this.presetRef.set(null);
    const base = structuredClone(this.policy() ?? defaultRoutingPolicy());
    this.policy.set(mutate(base));
  }

  private updateRule(i: number, mutate: (r: RoutingRule) => void): void {
    this.update((p) => {
      const rules = [...(p.rules ?? [])];
      const rule = structuredClone(rules[i]!);
      mutate(rule);
      rules[i] = rule;
      return { ...p, rules };
    });
  }

  setObjective(objective: RoutingObjective): void {
    this.update((p) => ({ ...p, objective }));
  }

  setMaxCandidates(value: unknown): void {
    this.update((p) => ({ ...p, maxCandidates: clampMaxCandidates(value) }));
  }

  addRule(): void {
    this.update((p) => ({ ...p, rules: [...(p.rules ?? []), { when: {}, prefer: {} }] }));
  }

  removeRule(i: number): void {
    this.update((p) => ({ ...p, rules: (p.rules ?? []).filter((_, j) => j !== i) }));
  }

  moveRule(i: number, delta: number): void {
    this.update((p) => {
      const rules = [...(p.rules ?? [])];
      const j = i + delta;
      if (j < 0 || j >= rules.length) return p;
      [rules[i], rules[j]] = [rules[j]!, rules[i]!];
      return { ...p, rules };
    });
  }

  setWhenCapability(i: number, value: string): void {
    this.updateRule(i, (r) => {
      if (value) r.when.capability = value as RoutingSpecialty;
      else delete r.when.capability;
    });
  }

  setWhenImages(i: number, on: boolean): void {
    this.updateRule(i, (r) => {
      if (on) r.when.hasImages = true;
      else delete r.when.hasImages;
    });
  }

  setWhenContext(i: number, value: unknown): void {
    const n = Math.round(Number(value));
    this.updateRule(i, (r) => {
      if (Number.isFinite(n) && n > 0) r.when.minContextTokens = n;
      else delete r.when.minContextTokens;
    });
  }

  hasSpecialty(rule: RoutingRule, s: RoutingSpecialty): boolean {
    return !!rule.prefer.specialties?.includes(s);
  }

  toggleSpecialty(i: number, s: RoutingSpecialty, on: boolean): void {
    this.updateRule(i, (r) => {
      const set = new Set(r.prefer.specialties ?? []);
      if (on) set.add(s);
      else set.delete(s);
      if (set.size) r.prefer.specialties = [...set];
      else delete r.prefer.specialties;
    });
  }

  setTier(i: number, value: string): void {
    this.updateRule(i, (r) => {
      if (value) r.prefer.tier = value as RoutingTier;
      else delete r.prefer.tier;
    });
  }

  removeModel(i: number, j: number): void {
    this.updateRule(i, (r) => {
      const models = (r.prefer.models ?? []).filter((_, k) => k !== j);
      if (models.length) r.prefer.models = models;
      else delete r.prefer.models;
    });
  }
}
