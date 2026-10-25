import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { Connector } from '../../core/models';
import { StudioApi } from '../../core/studio.api';
import type { Skill, SkillInput } from '../../core/studio.models';
import { ToastService } from '../../core/toast.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { NumberPipe } from '../../shared/usd.pipe';

/** Límite orientativo de las instrucciones: se cargan bajo demanda, pero cada carga consume tokens. */
const INSTRUCTIONS_SOFT_LIMIT = 20000;

@Component({
  selector: 'nx-skills',
  imports: [
    FormsModule,
    IconComponent,
    RelativeTimePipe,
    NumberPipe,
    EmptyStateComponent,
    ErrorStateComponent,
    LoadingStateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div><h1>Skills</h1><p>Habilidades reutilizables: instrucciones y operaciones que varios agentes pueden cargar cuando las necesitan</p></div>
        @if (auth.canEdit()) {
          <button class="btn primary" (click)="startNew()"><nx-icon name="plus" />Nueva skill</button>
        }
      </div>

      @if (loading()) {
        <nx-loading-state text="Cargando skills…" />
      } @else if (error()) {
        <nx-error-state title="No se pudieron cargar las skills" message="{{ error() }}" (retry)="load()" />
      } @else if (!skills().length && selectedId() === null) {
        <nx-empty-state icon="sparkles" title="Sin skills"
          description="Una skill empaqueta instrucciones (p. ej. «Cómo cotizar un envío») y las operaciones de conector que necesita.">
          @if (auth.canEdit()) {
            <div class="empty-actions"><button class="btn primary" (click)="startNew()"><nx-icon name="plus" [size]="16" />Crear la primera</button></div>
          }
        </nx-empty-state>
      } @else {
        <div class="master-detail">
          <div class="stack" role="list" aria-label="Skills">
            @for (s of skills(); track s.id) {
              <button type="button" role="listitem" class="list-item" [class.selected]="selectedId() === s.id" (click)="select(s)">
                <div class="icon-tile"><nx-icon name="sparkles" [size]="16" /></div>
                <span class="grow">
                  <strong class="block">{{ s.name }}</strong>
                  <span class="muted small clamp">{{ s.description || 'Sin descripción' }}</span>
                  <span class="row small muted meta">
                    <span><nx-icon name="bot" [size]="13" /> {{ s.agentCount }} {{ s.agentCount === 1 ? 'agente' : 'agentes' }}</span>
                    <span><nx-icon name="tool" [size]="13" /> {{ s.operationIds.length }}</span>
                    <span class="spacer"></span><span>{{ s.updatedAt | ago }}</span>
                  </span>
                </span>
              </button>
            }
          </div>

          @if (selectedId() !== null) {
            <form class="card stack" [class.editor]="auth.canEdit()" (ngSubmit)="save()">
              <div class="row wrap">
                <h2>{{ selectedId() === 'new' ? 'Nueva skill' : form.name || 'Skill' }}</h2>
                @if (current(); as c) {
                  <span class="badge" [class.primary]="c.agentCount > 0">Usada en {{ c.agentCount }} {{ c.agentCount === 1 ? 'agente' : 'agentes' }}</span>
                  <code class="small muted">{{ c.slug }}</code>
                }
                <span class="spacer"></span>
                <button type="button" class="btn ghost icon" title="Cerrar" aria-label="Cerrar editor" (click)="selectedId.set(null)"><nx-icon name="x" /></button>
              </div>
              <div class="field"><label for="sk-name">Nombre</label>
                <input id="sk-name" class="input" name="name" required [disabled]="!auth.canEdit()" [(ngModel)]="form.name" placeholder="Ej. Cotizar envíos" /></div>
              <div class="field"><label for="sk-desc">Cuándo usarla</label>
                <textarea id="sk-desc" class="input" name="description" rows="2" [disabled]="!auth.canEdit()" [(ngModel)]="form.description"
                  placeholder="Úsala cuando el cliente pida el precio o el plazo de un envío."></textarea>
                <span class="hint">Es lo único que el agente ve siempre; con esto decide si carga las instrucciones completas.</span></div>
              <div class="field"><label for="sk-instr">Instrucciones (markdown)</label>
                <textarea id="sk-instr" class="input textarea-mono" name="instructions" rows="18" spellcheck="false" [disabled]="!auth.canEdit()"
                  [(ngModel)]="form.instructions" placeholder="## Pasos&#10;1. Pide origen, destino y peso…"></textarea>
                <div class="row small"><span class="hint">Se cargan bajo demanda con la herramienta interna <code>load_skill</code>.</span><span class="spacer"></span>
                  <span class="char-count" [class.over]="form.instructions.length > softLimit" aria-live="polite">{{ form.instructions.length | num }} / {{ softLimit | num }} caracteres</span></div></div>

              <div class="field">
                <span class="lbl">Operaciones de conector asociadas <span class="badge">{{ ops().size }}</span></span>
                <span class="hint">Se suman a las herramientas de cada agente que use esta skill.</span>
                @if (connectorsError()) {
                  <div class="callout danger"><nx-icon name="alert" [size]="16" /><span>{{ connectorsError() }}</span></div>
                } @else if (connectors() === null) {
                  <p class="muted small">Cargando conectores…</p>
                } @else {
                  <div class="stack ops">
                    @for (c of connectors(); track c.id) {
                      <details class="group" [open]="groupCount(c) > 0">
                        <summary><div class="icon-tile sm {{ c.type }}"><nx-icon name="plug" [size]="14" /></div><strong>{{ c.name }}</strong>
                          <span class="badge">{{ c.type }}</span><span class="spacer"></span><span class="small muted">{{ groupCount(c) }} / {{ c.operations?.length ?? 0 }}</span></summary>
                        @for (op of c.operations; track op.id) {
                          <label class="op">
                            <input type="checkbox" [disabled]="!auth.canEdit()" [checked]="ops().has(op.id)" (change)="toggleOp(op.id, $any($event.target).checked)" />
                            <span><strong>{{ op.name }}</strong> <code class="small muted">{{ op.key }}</code>
                              @if (op.description) { <span class="muted small block">{{ op.description }}</span> }</span>
                          </label>
                        } @empty { <p class="muted small">Sin operaciones.</p> }
                      </details>
                    } @empty {
                      <p class="muted small">No hay conectores en el espacio de trabajo.</p>
                    }
                  </div>
                }
              </div>

              @if (auth.canEdit()) {
                <div class="row">
                  @if (current(); as c) {
                    <button type="button" class="btn danger" (click)="remove(c)"><nx-icon name="trash" [size]="15" />Eliminar</button>
                  }
                  <span class="spacer"></span>
                  <button type="button" class="btn" (click)="selectedId.set(null)">Cancelar</button>
                  <button type="submit" class="btn primary" [disabled]="saving() || !form.name.trim() || !form.description.trim()">
                    <nx-icon name="save" [size]="15" />{{ saving() ? 'Guardando…' : 'Guardar skill' }}</button>
                </div>
              }
            </form>
          } @else {
            <div class="hide-sm">
              <nx-empty-state icon="sparkles" title="Seleccione una skill" description="Verá sus instrucciones y operaciones asociadas." />
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .grow { flex: 1; min-width: 0; }
    .clamp { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .meta { gap: 10px; margin-top: 6px; }
    .lbl { font-size: 12.5px; font-weight: 600; color: var(--muted); display: inline-flex; gap: 6px; align-items: center; }
    .ops { gap: 8px; max-height: 420px; overflow: auto; }
    .group { border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; }
    .group summary { display: flex; align-items: center; gap: 8px; cursor: pointer; flex-wrap: wrap; }
    .icon-tile.sm { width: 26px; height: 26px; border-radius: 7px; }
    .op { display: flex; gap: 10px; align-items: flex-start; padding: 6px 4px; cursor: pointer; }
    .op input { margin-top: 3px; }
    .op code { margin-left: 6px; }
    @media (max-width: 900px) { .hide-sm { display: none; } }
  `,
})
export class SkillsPage implements OnInit {
  private readonly studio = inject(StudioApi);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);

  readonly softLimit = INSTRUCTIONS_SOFT_LIMIT;
  readonly skills = signal<Skill[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly connectors = signal<Connector[] | null>(null);
  readonly connectorsError = signal<string | null>(null);
  /** `null`: nada seleccionado · `'new'`: creando · id: editando. */
  readonly selectedId = signal<string | null>(null);
  readonly current = computed(() => this.skills().find((s) => s.id === this.selectedId()) ?? null);
  readonly ops = signal(new Set<string>());
  readonly saving = signal(false);
  form = { name: '', description: '', instructions: '' };

  ngOnInit() {
    void this.load();
    void this.loadConnectors();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.skills.set(await this.studio.skills());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadConnectors() {
    try {
      const list = await this.api.connectors();
      this.connectors.set(await Promise.all(list.map((c) => this.api.connector(c.id))));
    } catch (e) {
      this.connectorsError.set(errorMessage(e));
    }
  }

  startNew() {
    this.form = { name: '', description: '', instructions: '' };
    this.ops.set(new Set());
    this.selectedId.set('new');
  }

  select(s: Skill) {
    this.form = { name: s.name, description: s.description, instructions: s.instructions };
    this.ops.set(new Set(s.operationIds));
    this.selectedId.set(s.id);
  }

  groupCount(c: Connector) {
    const sel = this.ops();
    return (c.operations ?? []).filter((o) => sel.has(o.id)).length;
  }

  toggleOp(id: string, on: boolean) {
    const next = new Set(this.ops());
    if (on) next.add(id);
    else next.delete(id);
    this.ops.set(next);
  }

  async save() {
    if (!this.form.name.trim() || !this.form.description.trim() || this.saving()) return;
    this.saving.set(true);
    const data: SkillInput = {
      name: this.form.name.trim(),
      description: this.form.description.trim(),
      instructions: this.form.instructions,
      operationIds: [...this.ops()],
    };
    try {
      const id = this.selectedId();
      const saved = id && id !== 'new' ? await this.studio.updateSkill(id, data) : await this.studio.createSkill(data);
      this.skills.update((list) => {
        const exists = list.some((s) => s.id === saved.id);
        return exists ? list.map((s) => (s.id === saved.id ? saved : s)) : [saved, ...list];
      });
      this.select(saved);
      this.toast.success(id === 'new' ? 'Skill creada' : 'Skill guardada');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  async remove(s: Skill) {
    const usage = s.agentCount ? ` Se quitará de ${s.agentCount} ${s.agentCount === 1 ? 'agente' : 'agentes'}.` : '';
    if (!confirm(`¿Eliminar la skill «${s.name}»?${usage}`)) return;
    try {
      await this.studio.deleteSkill(s.id);
      this.skills.update((list) => list.filter((x) => x.id !== s.id));
      this.selectedId.set(null);
      this.toast.success('Skill eliminada');
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
