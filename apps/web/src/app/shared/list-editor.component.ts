import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { IconComponent } from './icon.component';

/** Editor de una lista de textos: agregar, editar, quitar y reordenar. Enlace bidireccional: [(items)]. */
@Component({
  selector: 'nx-list-editor',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="list" [attr.aria-label]="label()">
      @for (item of items(); track $index; let i = $index, first = $first, last = $last) {
        <li class="item">
          <span class="n muted small" aria-hidden="true">{{ i + 1 }}.</span>
          <input class="input" [value]="item" [disabled]="disabled()" [attr.aria-label]="label() + ' ' + (i + 1)"
            [placeholder]="placeholder()" (input)="edit(i, $any($event.target).value)" />
          @if (!disabled()) {
            <button type="button" class="btn ghost icon sm" title="Subir" aria-label="Subir" [disabled]="first" (click)="move(i, -1)"><nx-icon name="chevronUp" [size]="15" /></button>
            <button type="button" class="btn ghost icon sm" title="Bajar" aria-label="Bajar" [disabled]="last" (click)="move(i, 1)"><nx-icon name="chevronDown" [size]="15" /></button>
            <button type="button" class="btn ghost icon sm danger" title="Quitar" aria-label="Quitar" (click)="remove(i)"><nx-icon name="x" [size]="15" /></button>
          }
        </li>
      } @empty {
        <li class="muted small empty-item">{{ emptyText() }}</li>
      }
    </ol>
    @if (!disabled()) {
      <div class="add">
        <input #draft class="input" [placeholder]="placeholder()" [attr.aria-label]="'Nuevo: ' + label()"
          (keydown.enter)="add(draft); $event.preventDefault()" />
        <button type="button" class="btn sm" (click)="add(draft)"><nx-icon name="plus" [size]="14" />Agregar</button>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 6px; }
    .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .item { display: flex; gap: 4px; align-items: center; }
    .item .input { padding: 6px 10px; }
    .n { width: 20px; text-align: right; flex-shrink: 0; }
    .add { display: flex; gap: 8px; align-items: center; padding-left: 24px; }
    .add .input { padding: 6px 10px; }
    .empty-item { padding: 4px 0 0 24px; }
    .btn.icon.sm { width: 30px; }
  `,
})
export class ListEditorComponent {
  readonly items = model<string[]>([]);
  readonly label = input('Elemento');
  readonly placeholder = input('');
  readonly emptyText = input('Sin elementos.');
  readonly disabled = input(false);

  add(el: HTMLInputElement) {
    const v = el.value.trim();
    if (!v) return;
    this.items.update((list) => [...list, v]);
    el.value = '';
    el.focus();
  }

  edit(i: number, value: string) {
    this.items.update((list) => list.map((x, j) => (j === i ? value : x)));
  }

  remove(i: number) {
    this.items.update((list) => list.filter((_, j) => j !== i));
  }

  move(i: number, delta: number) {
    this.items.update((list) => {
      const next = [...list];
      const j = i + delta;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }
}
