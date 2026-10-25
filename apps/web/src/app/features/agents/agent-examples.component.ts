import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.service';
import { StudioApi } from '../../core/studio.api';
import type { AgentExample } from '../../core/studio.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

const MAX_EXAMPLES = 20;

/** Ejemplos de entrenamiento (few-shot): entrada → salida esperada. Se guardan al agregarlos. */
@Component({
  selector: 'nx-agent-examples',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card stack">
      <div class="row wrap">
        <nx-icon name="graduation" [size]="16" /><strong>Ejemplos de entrenamiento</strong>
        <span class="badge">{{ examples().length }} / {{ max }}</span>
      </div>
      <p class="muted small m0">Pares de entrada y salida esperada que se incluyen en el prompt para enseñar el estilo y el criterio del agente. Se guardan al agregarlos.</p>

      @if (loading()) {
        <p class="muted small">Cargando ejemplos…</p>
      } @else if (error()) {
        <div class="callout danger"><nx-icon name="alert" [size]="16" /><span>{{ error() }}</span>
          <button class="btn sm" (click)="load()">Reintentar</button></div>
      } @else {
        @for (ex of examples(); track ex.id; let i = $index) {
          <div class="example" [class.open]="isOpen(ex.id)">
            <button type="button" class="ex-head" [attr.aria-expanded]="isOpen(ex.id)" [attr.aria-label]="(isOpen(ex.id) ? 'Contraer' : 'Expandir') + ' ejemplo ' + (i + 1)" (click)="toggle(ex.id)">
              <nx-icon class="chev" name="chevronDown" [size]="14" />
              <span class="prev"><span class="tag">Entrada</span>{{ ex.input }}</span>
              <span class="prev out"><span class="tag out">Salida</span>{{ ex.output }}</span>
            </button>
            @if (canEdit()) {
              <button class="btn ghost icon sm danger del" title="Eliminar ejemplo" [attr.aria-label]="'Eliminar ejemplo ' + (i + 1)" (click)="remove(ex)"><nx-icon name="trash" [size]="15" /></button>
            }
            @if (isOpen(ex.id)) {
              <div class="body">
                <div class="io"><span class="tag">Entrada</span><p>{{ ex.input }}</p></div>
                <div class="io"><span class="tag out">Salida esperada</span><p>{{ ex.output }}</p></div>
              </div>
            }
          </div>
        } @empty {
          <p class="muted small">Aún no hay ejemplos.</p>
        }

        @if (canEdit()) {
          @if (examples().length < max) {
            <div class="grid grid-2 add">
              <div class="field"><label for="ex-in">Entrada del usuario</label>
                <textarea id="ex-in" class="input" rows="3" [(ngModel)]="draftInput" placeholder="¿Cuál es el plazo de entrega a Medellín?"></textarea></div>
              <div class="field"><label for="ex-out">Respuesta esperada</label>
                <textarea id="ex-out" class="input" rows="3" [(ngModel)]="draftOutput" placeholder="El plazo estándar es de 2 a 3 días hábiles…"></textarea></div>
            </div>
            <div class="row"><span class="spacer"></span>
              <button class="btn sm primary" [disabled]="adding() || !draftInput.trim() || !draftOutput.trim()" (click)="add()"><nx-icon name="plus" [size]="14" />Agregar ejemplo</button></div>
          } @else {
            <div class="callout"><nx-icon name="info" [size]="16" /><span>Alcanzó el máximo de {{ max }} ejemplos. Elimine alguno para agregar otro.</span></div>
          }
        }
      }
    </div>
  `,
  styles: `
    .m0 { margin: 0; }
    .example { position: relative; border: 1px solid var(--border); border-radius: 10px; }
    .example.open { background: var(--surface-2, var(--bg)); }
    .ex-head { display: grid; grid-template-columns: 16px 1fr 1fr; align-items: center; gap: 10px; width: 100%; padding: 9px 44px 9px 10px; background: none; border: 0; text-align: left; cursor: pointer; font: inherit; color: inherit; }
    .ex-head:hover { background: var(--surface-2, var(--bg)); border-radius: 10px; }
    .chev { color: var(--muted); transition: transform 0.15s ease; transform: rotate(-90deg); }
    .example.open .chev { transform: rotate(0); }
    .prev { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--muted); }
    .prev .tag { margin-right: 6px; }
    .body { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 0 44px 12px 36px; }
    .io p { margin: 4px 0 0; white-space: pre-wrap; word-break: break-word; font-size: 13px; color: var(--text); }
    .tag { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--info); }
    .tag.out { color: var(--success); }
    .del { position: absolute; top: 6px; right: 6px; width: 30px; }
    .add { padding-top: 6px; border-top: 1px dashed var(--border); }
    @media (max-width: 640px) { .ex-head, .body { grid-template-columns: 1fr; } .ex-head { grid-template-columns: 16px 1fr; } .prev.out { display: none; } }
  `,
})
export class AgentExamplesComponent implements OnInit {
  private readonly studio = inject(StudioApi);
  private readonly toast = inject(ToastService);
  readonly agentId = input.required<string>();
  readonly canEdit = input(false);
  readonly max = MAX_EXAMPLES;
  readonly examples = signal<AgentExample[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly adding = signal(false);
  readonly openIds = signal<ReadonlySet<string>>(new Set());
  draftInput = '';
  draftOutput = '';

  isOpen(id: string): boolean {
    return this.openIds().has(id);
  }

  toggle(id: string) {
    this.openIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.examples.set(await this.studio.examples(this.agentId()));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async add() {
    this.adding.set(true);
    try {
      const ex = await this.studio.createExample(this.agentId(), { input: this.draftInput.trim(), output: this.draftOutput.trim() });
      this.examples.update((list) => [...list, ex]);
      this.openIds.update((set) => new Set(set).add(ex.id));
      this.draftInput = '';
      this.draftOutput = '';
      this.toast.success('Ejemplo agregado');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.adding.set(false);
    }
  }

  async remove(ex: AgentExample) {
    if (!confirm('¿Eliminar este ejemplo?')) return;
    try {
      await this.studio.deleteExample(this.agentId(), ex.id);
      this.examples.update((list) => list.filter((x) => x.id !== ex.id));
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
