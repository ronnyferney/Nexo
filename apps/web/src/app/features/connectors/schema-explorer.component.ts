import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { IntegrationsApi } from '../../core/integrations.api';
import type { DbTable } from '../../core/integrations.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

const tableKey = (t: Pick<DbTable, 'schema' | 'name'>) => (t.schema ? `${t.schema}.${t.name}` : t.name);

/** Explorador de esquema de un conector `DATABASE` y generación de consultas `SELECT` sugeridas. */
@Component({
  selector: 'nx-schema-explorer',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card stack" aria-labelledby="schema-title">
      <div class="row wrap">
        <h2 id="schema-title" class="grow"><nx-icon name="table" [size]="16" /> Explorador de esquema</h2>
        <button class="btn sm" [disabled]="loading()" (click)="load()"><nx-icon name="refresh" [size]="14" />Actualizar</button>
      </div>
      <p class="muted small" style="margin:0">Elija tablas o vistas y Nexo creará una operación <code>SELECT</code> para cada una, lista para revisar.
        Los agentes y flujos solo pueden ejecutar estas consultas declaradas.</p>

      @if (loading()) {
        <p class="muted" role="status">Leyendo el esquema de la base de datos…</p>
      } @else if (error()) {
        <div class="callout danger" role="alert"><span class="grow">No se pudo leer el esquema: {{ error() }}</span>
          <button class="btn sm" (click)="load()">Reintentar</button></div>
      } @else if (!tables().length) {
        <div class="empty"><nx-icon name="database" [size]="32" /><h3>Sin tablas visibles</h3><p>El usuario configurado no tiene acceso a tablas o vistas.</p></div>
      } @else {
        <div class="row wrap">
          <label class="sr-only" for="schema-filter">Filtrar tablas</label>
          <input id="schema-filter" class="input filter" type="search" placeholder="Filtrar por esquema, tabla o columna" [ngModel]="filter()" (ngModelChange)="filter.set($event)" />
          <label class="checkbox small"><input type="checkbox" [checked]="allVisibleSelected()" [disabled]="!visible().length" (change)="toggleAll($any($event.target).checked)" />Seleccionar visibles</label>
        </div>
        <ul class="tables" aria-label="Tablas y vistas">
          @for (t of visible(); track key(t)) {
            <li>
              <details>
                <summary>
                  <input type="checkbox" [checked]="selected().has(key(t))" (click)="$event.stopPropagation()" (change)="toggle(key(t))"
                    [attr.aria-label]="'Seleccionar ' + key(t)" />
                  <span class="mono name">{{ key(t) }}</span>
                  <span class="badge" [class.info]="t.type === 'VIEW'">{{ t.type === 'VIEW' ? 'Vista' : 'Tabla' }}</span>
                  <span class="muted small">{{ t.columns.length }} col.</span>
                </summary>
                <ul class="cols">
                  @for (col of t.columns; track col.name) {
                    <li><span class="mono">{{ col.name }}</span> <span class="muted mono">{{ col.type }}</span>@if (col.nullable) { <span class="muted small"> · nulo</span> }</li>
                  }
                </ul>
              </details>
            </li>
          } @empty { <li class="muted small">Ninguna tabla coincide con el filtro.</li> }
        </ul>
        @if (auth.canEdit()) {
          <div class="row wrap"><span class="small muted grow">{{ selected().size }} seleccionadas de {{ tables().length }}</span>
            <button class="btn primary" [disabled]="!selected().size || creating()" (click)="create()">
              <nx-icon name="plus" [size]="16" />{{ creating() ? 'Creando…' : 'Crear consultas para las seleccionadas' }}</button></div>
        }
      }
    </section>
  `,
  styles: `
    .grow { flex: 1; min-width: 0; }
    .tables { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; max-height: 460px; overflow: auto; }
    details { border: 1px solid var(--border); border-radius: 9px; }
    details[open] { background: var(--surface-2); }
    summary { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; flex-wrap: wrap; }
    summary .name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .cols { margin: 0; padding: 4px 12px 10px 38px; display: grid; gap: 2px; font-size: 12.5px; }
    .cols li { display: flex; flex-wrap: wrap; gap: 4px 8px; }
    .filter { flex: 1 1 220px; }
  `,
})
export class SchemaExplorerComponent implements OnInit {
  private readonly api = inject(IntegrationsApi);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);

  readonly connectorId = input.required<string>();
  readonly created = output<number>();

  readonly tables = signal<DbTable[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly filter = signal('');
  readonly selected = signal<Set<string>>(new Set());
  readonly creating = signal(false);

  readonly visible = computed(() => {
    const q = this.filter().trim().toLowerCase();
    if (!q) return this.tables();
    return this.tables().filter((t) => tableKey(t).toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q)));
  });
  readonly allVisibleSelected = computed(() => this.visible().length > 0 && this.visible().every((t) => this.selected().has(tableKey(t))));

  key = tableKey;

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.api.schema(this.connectorId());
      this.tables.set(res.tables ?? []);
      const keys = new Set(this.tables().map(tableKey));
      this.selected.update((s) => new Set([...s].filter((k) => keys.has(k))));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  toggle(key: string) {
    this.selected.update((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  toggleAll(checked: boolean) {
    this.selected.update((s) => {
      const next = new Set(s);
      for (const t of this.visible()) {
        if (checked) next.add(tableKey(t));
        else next.delete(tableKey(t));
      }
      return next;
    });
  }

  async create() {
    this.creating.set(true);
    try {
      const r = await this.api.discoverTables(this.connectorId(), [...this.selected()]);
      this.toast.success(`${r.imported} ${r.imported === 1 ? 'consulta creada' : 'consultas creadas'}`);
      this.selected.set(new Set());
      this.created.emit(r.imported);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.creating.set(false);
    }
  }
}
