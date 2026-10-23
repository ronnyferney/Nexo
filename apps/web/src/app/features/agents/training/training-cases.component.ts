import { ChangeDetectionStrategy, Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/api.service';
import { TrainingApi } from '../../../core/training.api';
import type { EvalCase, EvalCaseInput } from '../../../core/training.models';
import { ToastService } from '../../../core/toast.service';
import { IconComponent } from '../../../shared/icon.component';

interface Draft {
  id: string | null;
  input: string;
  expected: string;
  criteria: string;
  tags: string;
}

const EMPTY_DRAFT: Draft = { id: null, input: '', expected: '', criteria: '', tags: '' };
const IMPORT_EXAMPLE = `[
  { "input": "¿Cuál es el plazo de entrega?", "expected": "De 2 a 3 días hábiles.", "criteria": "Menciona el plazo y es cordial" },
  { "input": "Quiero cancelar mi pedido" }
]`;

/** Valida el JSON pegado: arreglo de `{ input, expected?, criteria?, tags? }`. Devuelve los casos o los errores. */
export function parseCasesJson(text: string): { cases: EvalCaseInput[]; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { cases: [], errors: [`JSON inválido: ${(e as Error).message}`] };
  }
  if (!Array.isArray(data)) return { cases: [], errors: ['Se esperaba un arreglo de casos: [ { "input": "…" } ]'] };
  if (!data.length) return { cases: [], errors: ['El arreglo está vacío.'] };
  const cases: EvalCaseInput[] = [];
  const errors: string[] = [];
  data.forEach((item, i) => {
    const n = i + 1;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return void errors.push(`Caso ${n}: debe ser un objeto.`);
    const o = item as Record<string, unknown>;
    if (typeof o['input'] !== 'string' || !o['input'].trim()) return void errors.push(`Caso ${n}: «input» es obligatorio y debe ser texto.`);
    for (const k of ['expected', 'criteria'] as const) {
      if (o[k] !== undefined && o[k] !== null && typeof o[k] !== 'string') errors.push(`Caso ${n}: «${k}» debe ser texto.`);
    }
    if (o['tags'] !== undefined && (!Array.isArray(o['tags']) || o['tags'].some((t) => typeof t !== 'string'))) {
      errors.push(`Caso ${n}: «tags» debe ser un arreglo de textos.`);
    }
    const unknown = Object.keys(o).filter((k) => !['input', 'expected', 'criteria', 'tags'].includes(k));
    if (unknown.length) errors.push(`Caso ${n}: campos no admitidos: ${unknown.join(', ')}.`);
    cases.push({
      input: o['input'].trim(),
      expected: typeof o['expected'] === 'string' && o['expected'].trim() ? o['expected'].trim() : undefined,
      criteria: typeof o['criteria'] === 'string' && o['criteria'].trim() ? o['criteria'].trim() : undefined,
      tags: Array.isArray(o['tags']) ? (o['tags'] as string[]).map((t) => t.trim()).filter(Boolean) : undefined,
    });
  });
  return { cases: errors.length ? [] : cases, errors };
}

/** Paso «Casos»: casos de evaluación del agente (CRUD e importación desde JSON). */
@Component({
  selector: 'nx-training-cases',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      <div class="row wrap">
        <p class="muted small m0 grow">Cada caso es una entrada de prueba con la respuesta esperada y/o los criterios con que el juez IA califica la salida del agente.</p>
        @if (canEdit()) {
          <button class="btn sm" [attr.aria-expanded]="importing()" (click)="toggleImport()"><nx-icon name="upload" [size]="14" />Importar JSON</button>
          <button class="btn sm primary" (click)="edit(null)"><nx-icon name="plus" [size]="14" />Nuevo caso</button>
        }
      </div>

      @if (importing()) {
        <div class="card stack editor">
          <div class="field"><label for="cases-json">Pegue un arreglo JSON de casos</label>
            <textarea id="cases-json" class="input code" rows="8" [(ngModel)]="importText" [placeholder]="importExample"
              [class.invalid]="importErrors().length" [attr.aria-describedby]="importErrors().length ? 'cases-json-err' : 'cases-json-hint'"></textarea>
            <span class="hint" id="cases-json-hint">Formato: <code>[{{ '{' }} "input": "…", "expected": "…", "criteria": "…", "tags": ["…"] {{ '}' }}]</code> — solo <code>input</code> es obligatorio.</span>
          </div>
          @if (importErrors().length) {
            <div class="callout danger" id="cases-json-err" role="alert"><nx-icon name="alert" [size]="15" />
              <ul class="errs">@for (e of importErrors(); track $index) { <li>{{ e }}</li> }</ul></div>
          }
          <div class="row"><span class="spacer"></span>
            <button class="btn sm" (click)="toggleImport()">Cancelar</button>
            <button class="btn sm primary" [disabled]="busy() || !importText.trim()" (click)="runImport()">{{ busy() ? progress() : 'Validar e importar' }}</button>
          </div>
        </div>
      }

      @if (draft(); as d) {
        <form class="card stack editor" (ngSubmit)="saveDraft()">
          <strong>{{ d.id ? 'Editar caso' : 'Nuevo caso' }}</strong>
          <div class="field"><label for="case-input">Entrada del usuario</label>
            <textarea id="case-input" class="input" rows="3" name="input" required [(ngModel)]="d.input"></textarea></div>
          <div class="grid grid-2">
            <div class="field"><label for="case-expected">Respuesta esperada (opcional)</label>
              <textarea id="case-expected" class="input" rows="4" name="expected" [(ngModel)]="d.expected"></textarea></div>
            <div class="field"><label for="case-criteria">Criterios / rúbrica (opcional)</label>
              <textarea id="case-criteria" class="input" rows="4" name="criteria" [(ngModel)]="d.criteria" placeholder="Debe citar la política de devoluciones; no prometer reembolsos."></textarea></div>
          </div>
          <div class="field"><label for="case-tags">Etiquetas (separadas por coma)</label>
            <input id="case-tags" class="input" name="tags" [(ngModel)]="d.tags" placeholder="envíos, tono" /></div>
          <div class="row"><span class="spacer"></span>
            <button type="button" class="btn sm" (click)="draft.set(null)">Cancelar</button>
            <button type="submit" class="btn sm primary" [disabled]="busy() || !d.input.trim()">{{ busy() ? 'Guardando…' : 'Guardar caso' }}</button>
          </div>
        </form>
      }

      @if (loading() && !cases().length) {
        <div class="card empty"><p>Cargando casos…</p></div>
      } @else if (error()) {
        <div class="card empty"><nx-icon name="alert" [size]="28" /><h3>No se pudieron cargar los casos</h3><p>{{ error() }}</p>
          <button class="btn" (click)="load()">Reintentar</button></div>
      } @else if (!cases().length) {
        <div class="card empty"><nx-icon name="list" [size]="32" /><h3>Sin casos de evaluación</h3>
          <p>Cree casos o apruebe retroalimentación con «Agregar también como caso de evaluación».</p></div>
      } @else {
        <div class="card flush">
          <div class="table-wrap">
            <table class="table">
              <caption class="sr-only">Casos de evaluación ({{ cases().length }})</caption>
              <thead><tr><th>Entrada</th><th>Respuesta esperada</th><th>Criterios</th><th>Etiquetas</th>@if (canEdit()) { <th><span class="sr-only">Acciones</span></th> }</tr></thead>
              <tbody>
                @for (c of cases(); track c.id; let i = $index) {
                  <tr>
                    <td><span class="clamp" [title]="c.input">{{ c.input }}</span></td>
                    <td><span class="clamp" [title]="c.expected ?? ''">{{ c.expected || '—' }}</span></td>
                    <td><span class="clamp" [title]="c.criteria ?? ''">{{ c.criteria || '—' }}</span></td>
                    <td><div class="tags">@for (t of c.tags; track t) { <span class="badge">{{ t }}</span> } @empty { <span class="muted">—</span> }</div></td>
                    @if (canEdit()) {
                      <td class="nowrap">
                        <button class="btn ghost icon sm" title="Editar" [attr.aria-label]="'Editar caso ' + (i + 1)" (click)="edit(c)"><nx-icon name="pencil" [size]="14" /></button>
                        <button class="btn ghost icon sm danger" title="Eliminar" [attr.aria-label]="'Eliminar caso ' + (i + 1)" (click)="remove(c)"><nx-icon name="trash" [size]="14" /></button>
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .m0 { margin: 0; }
    .grow { flex: 1; min-width: 220px; }
    .card.flush { padding: 0; overflow: hidden; }
    .clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; word-break: break-word; min-width: 140px; font-size: 13px; }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; }
    .errs { margin: 0; padding-left: 18px; }
    td { vertical-align: top !important; }
  `,
})
export class TrainingCasesComponent implements OnInit {
  private readonly training = inject(TrainingApi);
  private readonly toast = inject(ToastService);
  readonly agentId = input.required<string>();
  readonly canEdit = input(false);
  readonly changed = output<void>();

  readonly cases = signal<EvalCase[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly draft = signal<Draft | null>(null);
  readonly busy = signal(false);
  readonly importing = signal(false);
  readonly importErrors = signal<string[]>([]);
  readonly progress = signal('');
  readonly importExample = IMPORT_EXAMPLE;
  importText = '';

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.cases.set(await this.training.evalCases(this.agentId()));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  edit(c: EvalCase | null) {
    this.importing.set(false);
    this.draft.set(
      c
        ? { id: c.id, input: c.input, expected: c.expected ?? '', criteria: c.criteria ?? '', tags: (c.tags ?? []).join(', ') }
        : { ...EMPTY_DRAFT },
    );
    setTimeout(() => document.getElementById('case-input')?.focus());
  }

  async saveDraft() {
    const d = this.draft();
    if (!d || !d.input.trim()) return;
    const data: EvalCaseInput = {
      input: d.input.trim(),
      expected: d.expected.trim(),
      criteria: d.criteria.trim(),
      tags: d.tags.split(',').map((t) => t.trim()).filter(Boolean),
    };
    this.busy.set(true);
    try {
      if (d.id) {
        const saved = await this.training.updateEvalCase(d.id, data);
        this.cases.update((l) => l.map((c) => (c.id === d.id ? { ...c, ...data, ...saved } : c)));
      } else {
        const saved = await this.training.createEvalCase(this.agentId(), {
          ...data,
          expected: data.expected || undefined,
          criteria: data.criteria || undefined,
        });
        this.cases.update((l) => [...l, saved]);
        this.changed.emit();
      }
      this.draft.set(null);
      this.toast.success('Caso guardado');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async remove(c: EvalCase) {
    if (!confirm('¿Eliminar este caso de evaluación?')) return;
    try {
      await this.training.deleteEvalCase(c.id);
      this.cases.update((l) => l.filter((x) => x.id !== c.id));
      this.changed.emit();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  toggleImport() {
    this.draft.set(null);
    this.importing.update((v) => !v);
    this.importErrors.set([]);
  }

  async runImport() {
    const { cases, errors } = parseCasesJson(this.importText);
    this.importErrors.set(errors);
    if (errors.length) return;
    this.busy.set(true);
    const failed: string[] = [];
    const pending: EvalCaseInput[] = [];
    let created = 0;
    for (const [i, c] of cases.entries()) {
      this.progress.set(`Importando ${i + 1} de ${cases.length}…`);
      try {
        const saved = await this.training.createEvalCase(this.agentId(), c);
        this.cases.update((l) => [...l, saved]);
        created++;
      } catch (e) {
        failed.push(`Caso ${i + 1}: ${errorMessage(e)}`);
        pending.push(c);
      }
    }
    this.busy.set(false);
    if (created) {
      this.toast.success(`${created} ${created === 1 ? 'caso importado' : 'casos importados'}`);
      this.changed.emit();
    }
    if (failed.length) {
      // Deja en el cuadro solo los casos que fallaron, para reintentar sin duplicar los ya creados.
      this.importText = JSON.stringify(pending, null, 2);
      this.importErrors.set([...failed, 'Los casos importados se quitaron del cuadro; corrija y reintente los restantes.']);
    } else {
      this.importText = '';
      this.importing.set(false);
    }
  }
}
