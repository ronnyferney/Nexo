import { ChangeDetectionStrategy, Component, effect, input, model, signal } from '@angular/core';

/** Editor JSON con validación en vivo y enlace bidireccional del objeto: [(value)]. */
@Component({
  selector: 'nx-json-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <textarea class="input code" [class.invalid]="error()" [rows]="rows()" [value]="text()"
      [placeholder]="placeholder()" spellcheck="false" (input)="onInput($any($event.target).value)"></textarea>
    @if (error()) { <div class="error-text">{{ error() }}</div> }
  `,
  styles: [':host { display: flex; flex-direction: column; gap: 4px; }'],
})
export class JsonEditorComponent {
  readonly value = model<unknown>({});
  readonly rows = input(8);
  readonly placeholder = input('{ }');
  readonly text = signal('');
  readonly error = signal<string | null>(null);
  private lastEmitted: unknown;

  constructor() {
    effect(() => {
      const v = this.value();
      if (v !== this.lastEmitted) this.text.set(JSON.stringify(v ?? {}, null, 2));
    });
  }

  onInput(raw: string) {
    this.text.set(raw);
    try {
      const parsed = raw.trim() ? JSON.parse(raw) : {};
      this.error.set(null);
      this.lastEmitted = parsed;
      this.value.set(parsed);
    } catch (e) {
      this.error.set(`JSON inválido: ${(e as Error).message}`);
    }
  }
}
