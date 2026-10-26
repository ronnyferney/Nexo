import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { ResultsApi } from '../../core/results.api';
import type { Objetivo, Tarea } from '../../core/results.models';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { PageHeaderComponent } from '../../layout/page-header.component';
import { estadoTareaMeta } from './trabajo.util';

/**
 * Objetivos (RF07): lista simple con indicador, línea base, meta y plazo, y las tareas vinculadas (un objetivo agrupa
 * tareas). Lo autoriza un humano; el sistema solo propone. Estados de carga, vacío y error compartidos.
 */
@Component({
  selector: 'nx-objetivos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    IconComponent,
    ErrorStateComponent,
    EmptyStateComponent,
    LoadingStateComponent,
    PageHeaderComponent,
  ],
  template: `
    <div class="page">
      <nx-page-header heading="Objetivos" description="Indicador, meta y plazo de cada objetivo, con sus tareas vinculadas">
        <button actions class="btn" (click)="load()" [disabled]="loading()">
          <nx-icon name="refresh" [size]="15" />Actualizar
        </button>
      </nx-page-header>

      @if (loading()) {
        <nx-loading-state text="Cargando objetivos…" />
      } @else if (error()) {
        <nx-error-state message="{{ error() }}" (retry)="load()" />
      } @else if (objetivos().length) {
        <div class="lista">
          @for (o of objetivos(); track o.id) {
            <section class="card" [attr.aria-label]="o.nombre">
              <header class="cab">
                <span class="badge primary">{{ o.codigo }}</span>
                <h2>{{ o.nombre }}</h2>
                @if (o.plazo) {
                  <span class="badge"><nx-icon name="clock" [size]="12" />{{ o.plazo | date: 'mediumDate' }}</span>
                }
              </header>
              <dl class="campos">
                @if (o.indicador) {
                  <dt>Indicador</dt>
                  <dd>{{ o.indicador }}</dd>
                }
                @if (o.lineaBase) {
                  <dt>Línea base</dt>
                  <dd>{{ o.lineaBase }}</dd>
                }
                @if (o.meta) {
                  <dt>Meta</dt>
                  <dd>{{ o.meta }}</dd>
                }
              </dl>
              <div class="tareas">
                <h3>Tareas vinculadas ({{ tareasDe(o.id).length }})</h3>
                @if (tareasDe(o.id).length) {
                  <ul>
                    @for (t of tareasDe(o.id); track t.id) {
                      <li>
                        <a [routerLink]="['/trabajo/tareas', t.id]">{{ t.titulo }}</a>
                        <span class="badge {{ metaOp(t.estado).badge }}">{{ metaOp(t.estado).label }}</span>
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="muted">Sin tareas vinculadas.</p>
                }
              </div>
            </section>
          }
        </div>
      } @else {
        <nx-empty-state
          icon="target"
          title="Sin objetivos"
          description="Aún no hay objetivos en este workspace. Un objetivo define indicador, meta y plazo (RF07)." />
      }
    </div>
  `,
  styles: `
    .lista { display: flex; flex-direction: column; gap: 16px; }
    .cab { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 12px; }
    .cab h2 { font-size: 16px; margin: 0; flex: 1; min-width: 180px; }
    .campos { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0 0 14px; }
    .campos dt { color: var(--muted); font-size: 12.5px; font-weight: 600; }
    .campos dd { margin: 0; font-size: 13.5px; }
    .tareas h3 { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 8px; }
    .tareas ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .tareas li { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
    .tareas li a { font-size: 13.5px; }
    @media (max-width: 560px) { .campos { grid-template-columns: 1fr; gap: 2px 0; } }
  `,
})
export class ObjetivosPage implements OnInit {
  private readonly api = inject(ResultsApi);

  protected readonly objetivos = signal<Objetivo[]>([]);
  protected readonly tareas = signal<Tarea[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  private readonly porObjetivo = computed(() => {
    const map = new Map<string, Tarea[]>();
    for (const t of this.tareas()) {
      if (!t.objetivoId) continue;
      const arr = map.get(t.objetivoId) ?? [];
      arr.push(t);
      map.set(t.objetivoId, arr);
    }
    return map;
  });

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [objetivos, tareas] = await Promise.all([this.api.objetivos(), this.api.tareas()]);
      this.objetivos.set(objetivos);
      this.tareas.set(tareas);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected tareasDe(objetivoId: string): Tarea[] {
    return this.porObjetivo().get(objetivoId) ?? [];
  }
  protected metaOp = estadoTareaMeta;
}
