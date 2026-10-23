import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { SqlOperationDefinition } from '../../core/integrations.models';
import { IconComponent } from '../../shared/icon.component';
import { detectSqlParams, proposeInputSchema, schemaDrift } from './sql-params';

/** Editor de una consulta SQL declarada (ADR 0005 D4): SQL con parámetros `:nombre`, modo y límites. */
@Component({
  selector: 'nx-sql-operation-editor',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = def();
    <div class="field"><label for="sql-text">Consulta SQL</label>
      <textarea id="sql-text" class="input code" rows="8" spellcheck="false" aria-describedby="sql-h"
        placeholder="SELECT placa, estado FROM vehiculos WHERE placa = :placa" [ngModel]="d.sql" (ngModelChange)="setSql($event)"></textarea>
      <span class="hint" id="sql-h">Use parámetros nombrados como <code>:placa</code>; se enlazan en el motor, nunca se concatenan.
        En modo lectura solo se admite <code>SELECT</code> o <code>WITH</code>.</span>
    </div>

    <div class="params">
      <span class="small muted">Parámetros detectados:</span>
      @for (p of params(); track p) { <code class="badge primary">:{{ p }}</code> } @empty { <span class="small muted">ninguno</span> }
    </div>
    @if (drift().missing.length || drift().unused.length) {
      <div class="callout info" role="status"><nx-icon name="info" [size]="16" />
        <span class="grow">
          @if (drift().missing.length) { Sin describir en el esquema: <strong>{{ drift().missing.join(', ') }}</strong>. }
          @if (drift().unused.length) { Sin uso en la consulta: <strong>{{ drift().unused.join(', ') }}</strong>. }
        </span>
        <button type="button" class="btn sm" (click)="applySchema()">Actualizar esquema</button>
      </div>
    }

    <div class="grid grid-3">
      <div class="field"><label for="sql-mode">Modo</label>
        <select id="sql-mode" class="input" [ngModel]="d.mode" (ngModelChange)="patch({ mode: $event })">
          <option value="read">Lectura</option>
          <option value="write" [disabled]="!allowWrites() && d.mode !== 'write'">Escritura{{ allowWrites() ? '' : ' (no permitida)' }}</option>
        </select>
        @if (d.mode === 'write' && !allowWrites()) { <span class="error-text">El conector no permite escrituras: habilítelas en Configuración.</span> }
      </div>
      <div class="field"><label for="sql-rows">Máximo de filas</label>
        <input id="sql-rows" class="input" type="number" min="1" max="5000" [ngModel]="d.maxRows" (ngModelChange)="patch({ maxRows: num($event) })" placeholder="500" />
        <span class="hint">Hasta 5000.</span></div>
      <div class="field"><label for="sql-timeout">Timeout (ms)</label>
        <input id="sql-timeout" class="input" type="number" min="1000" max="60000" step="1000" [ngModel]="d.timeoutMs" (ngModelChange)="patch({ timeoutMs: num($event) })" placeholder="15000" />
        <span class="hint">Hasta 60000.</span></div>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 12px; }
    .params { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .grow { flex: 1; min-width: 0; }
    .hint, .error-text { font-size: 12px; }
  `,
})
export class SqlOperationEditorComponent {
  readonly definition = model<Record<string, unknown>>({});
  readonly inputSchema = model<Record<string, unknown>>({});
  /** En operaciones nuevas el esquema se propone automáticamente al escribir la consulta. */
  readonly autoSchema = input(false);
  readonly allowWrites = input(false);

  readonly def = computed(() => {
    const d = this.definition() as Partial<SqlOperationDefinition>;
    return { sql: d.sql ?? '', mode: d.mode ?? 'read', maxRows: d.maxRows ?? 500, timeoutMs: d.timeoutMs ?? 15000 } as SqlOperationDefinition;
  });
  readonly params = computed(() => detectSqlParams(this.def().sql));
  readonly drift = computed(() => schemaDrift(this.params(), this.inputSchema()));

  patch(p: Partial<SqlOperationDefinition>) {
    this.definition.set({ ...this.def(), ...p });
  }

  setSql(sql: string) {
    this.patch({ sql });
    if (this.autoSchema()) this.applySchema();
  }

  applySchema() {
    this.inputSchema.set(proposeInputSchema(this.params(), this.inputSchema()));
  }

  num(v: unknown) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
  }
}
