import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, model, signal, viewChildren } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ICON_NAMES, IconComponent } from './icon.component';
import { filterIconNames } from './icon-picker.util';

/**
 * Biblioteca y selector de íconos reutilizable: muestra una cuadrícula con los íconos disponibles (derivados del mapa
 * de `IconComponent`), con búsqueda por nombre, opción «Sin ícono» y navegación por teclado. El valor es el nombre del
 * ícono elegido o `null` (que se interpreta como el ícono por defecto en quien lo consuma).
 */
@Component({
  selector: 'nx-icon-picker',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="picker" [class.disabled]="disabled()">
      <div class="search">
        <nx-icon name="search" [size]="15" />
        <input
          type="search"
          class="input"
          [disabled]="disabled()"
          [placeholder]="'Buscar ícono…'"
          [attr.aria-label]="'Buscar ícono'"
          [ngModel]="query()"
          (ngModelChange)="query.set($event)"
        />
      </div>
      <div class="grid" role="listbox" [attr.aria-label]="'Biblioteca de íconos'" [attr.aria-disabled]="disabled() ? 'true' : null">
        <button
          #cell
          type="button"
          role="option"
          class="cell none"
          [class.active]="icon() === null"
          [attr.aria-selected]="icon() === null"
          [attr.aria-label]="'Sin ícono (usar el predeterminado)'"
          title="Sin ícono"
          [disabled]="disabled()"
          [tabindex]="roving(0)"
          (click)="choose(null)"
          (keydown)="onKey($event, 0)"
        >
          <nx-icon name="x" [size]="18" />
        </button>
        @for (name of visible(); track name; let i = $index) {
          <button
            #cell
            type="button"
            role="option"
            class="cell"
            [class.active]="icon() === name"
            [attr.aria-selected]="icon() === name"
            [attr.aria-label]="name"
            [title]="name"
            [disabled]="disabled()"
            [tabindex]="roving(i + 1)"
            (click)="choose(name)"
            (keydown)="onKey($event, i + 1)"
          >
            <nx-icon [name]="name" [size]="18" />
          </button>
        } @empty {
          <p class="empty muted small">Ningún ícono coincide con «{{ query() }}».</p>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .search { position: relative; display: flex; align-items: center; margin-bottom: 10px; }
      .search nx-icon { position: absolute; left: 10px; color: var(--muted); pointer-events: none; }
      .search .input { padding-left: 32px; }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
        gap: 6px;
        max-height: 220px;
        overflow-y: auto;
        padding: 4px;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: var(--surface);
      }
      .cell {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        aspect-ratio: 1;
        border: 1px solid transparent;
        border-radius: 9px;
        background: transparent;
        color: var(--text);
        cursor: pointer;
        transition: border-color 0.15s, background 0.15s, color 0.15s;
      }
      .cell:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
      .cell:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
      .cell.active { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 14%, transparent); color: var(--primary); }
      .cell.none { color: var(--muted); }
      .picker.disabled .cell { cursor: not-allowed; opacity: 0.6; }
      .empty { grid-column: 1 / -1; margin: 8px; }
    `,
  ],
})
export class IconPickerComponent {
  /** Nombre del ícono elegido, o `null` para «Sin ícono». */
  readonly icon = model.required<string | null>();
  readonly disabled = input(false);

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly cells = viewChildren<ElementRef<HTMLButtonElement>>('cell');

  readonly query = signal('');
  readonly names = ICON_NAMES;
  readonly visible = computed(() => filterIconNames(this.names, this.query()));

  /** Índice del botón que debe recibir el foco (roving tabindex): el activo, o el primero. */
  private readonly focusIndex = signal(0);

  /** Calcula el `tabindex` del botón en la posición dada (0 = «Sin ícono»). */
  roving(index: number): 0 | -1 {
    return index === this.activeIndex() ? 0 : -1;
  }

  /** Posición del ícono seleccionado dentro de la cuadrícula visible (0 = «Sin ícono»). */
  private activeIndex(): number {
    const sel = this.icon();
    if (sel === null) return 0;
    const i = this.visible().indexOf(sel);
    return i >= 0 ? i + 1 : this.focusIndex();
  }

  choose(name: string | null) {
    if (this.disabled()) return;
    this.icon.set(name);
  }

  /** Navegación por teclado estilo cuadrícula (flechas, Inicio/Fin) con foco móvil. */
  onKey(e: KeyboardEvent, index: number) {
    const total = this.visible().length + 1; // +1 por la opción «Sin ícono»
    const cols = this.columns();
    let next = index;
    switch (e.key) {
      case 'ArrowRight': next = Math.min(total - 1, index + 1); break;
      case 'ArrowLeft': next = Math.max(0, index - 1); break;
      case 'ArrowDown': next = Math.min(total - 1, index + cols); break;
      case 'ArrowUp': next = Math.max(0, index - cols); break;
      case 'Home': next = 0; break;
      case 'End': next = total - 1; break;
      default: return;
    }
    e.preventDefault();
    this.focusIndex.set(next);
    this.cells()[next]?.nativeElement.focus();
  }

  /** Número de columnas de la cuadrícula (según el ancho real) para mover el foco verticalmente. */
  private columns(): number {
    const grid = this.host.nativeElement.querySelector('.grid') as HTMLElement | null;
    if (!grid) return 1;
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
    return Math.max(1, cols);
  }
}
