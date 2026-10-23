import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/api.service';
import { TrainingApi } from '../../../core/training.api';
import type { AgentVersion } from '../../../core/training.models';
import { ToastService } from '../../../core/toast.service';
import { IconComponent } from '../../../shared/icon.component';
import { RelativeTimePipe } from '../../../shared/relative-time.pipe';
import { ScorePipe } from '../../../shared/score.pipe';
import { formatDateTime } from './training-utils';

/** Paso «Publicar»: instantáneas de la configuración del agente con su mejor puntaje; guardar y publicar. */
@Component({
  selector: 'nx-training-versions',
  imports: [FormsModule, IconComponent, RelativeTimePipe, ScorePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      @if (canEdit()) {
        <form class="card save-v" (ngSubmit)="save()">
          <div class="field grow"><label for="version-note">Nota de la versión</label>
            <input id="version-note" class="input" name="note" maxlength="200" [(ngModel)]="note" placeholder="Ej.: perfil con límites de reembolso" /></div>
          <button type="submit" class="btn primary" [disabled]="saving()"><nx-icon name="save" [size]="15" />{{ saving() ? 'Guardando…' : 'Guardar versión' }}</button>
        </form>
        @if (dirty()) {
          <div class="callout warning"><nx-icon name="alert" [size]="15" /><span>Hay cambios sin guardar: la versión toma la configuración guardada del agente. Pulse «Guardar» arriba primero.</span></div>
        }
      }
      @if (warnings().length) {
        <div class="callout warning" role="status"><nx-icon name="alert" [size]="15" />
          <div class="grow"><strong>Versión publicada con advertencias</strong><ul class="warns">@for (w of warnings(); track $index) { <li>{{ w }}</li> }</ul></div>
          <button class="btn ghost icon sm" title="Cerrar" aria-label="Cerrar advertencias" (click)="warnings.set([])"><nx-icon name="x" [size]="14" /></button></div>
      }

      @if (loading() && !versions().length) {
        <div class="card empty"><p>Cargando versiones…</p></div>
      } @else if (error()) {
        <div class="card empty"><nx-icon name="alert" [size]="28" /><h3>No se pudieron cargar las versiones</h3><p>{{ error() }}</p>
          <button class="btn" (click)="load()">Reintentar</button></div>
      } @else {
        <ol class="versions">
          @for (v of versions(); track v.id) {
            <li class="card ver" [class.best]="v.id === bestId()">
              <span class="vnum">v{{ v.version }}</span>
              <div class="grow">
                <div class="row wrap tight">
                  <strong>{{ v.note || 'Sin nota' }}</strong>
                  @if (v.id === bestId()) { <span class="badge success"><nx-icon name="trophy" [size]="12" />Mejor puntaje</span> }
                </div>
                <span class="muted small" [title]="fmt(v.createdAt)">{{ v.createdByName || 'Sistema' }} · {{ v.createdAt | ago }}</span>
              </div>
              <div class="score"><span class="muted small">Mejor puntaje</span><strong>{{ v.bestScore | score }}</strong></div>
              @if (canEdit()) {
                <button class="btn sm" [disabled]="publishing() === v.id" (click)="publish(v)"><nx-icon name="rocket" [size]="14" />{{ publishing() === v.id ? 'Publicando…' : 'Publicar' }}</button>
              }
            </li>
          } @empty {
            <li class="card empty"><nx-icon name="layers" [size]="32" /><h3>Sin versiones</h3>
              <p>Las versiones se crean al guardarlas, al aplicar una sugerencia y antes de publicar otra.</p></li>
          }
        </ol>
      }
    </div>
  `,
  styles: `
    .save-v { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; padding: 16px; }
    .grow { flex: 1; min-width: 0; }
    .save-v .grow { min-width: 200px; }
    .warns { margin: 4px 0 0; padding-left: 18px; }
    .versions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .ver { display: flex; align-items: center; gap: 12px; padding: 12px 14px; flex-wrap: wrap; }
    .ver.best { border-color: var(--success); background: color-mix(in srgb, var(--success-50) 55%, var(--surface)); }
    .vnum { width: 42px; height: 42px; border-radius: 10px; display: grid; place-items: center; font-weight: 750; background: var(--primary-50); color: var(--primary); flex-shrink: 0; }
    .ver.best .vnum { background: var(--success-50); color: var(--success); }
    .tight { gap: 8px; }
    .score { display: flex; flex-direction: column; align-items: flex-end; font-variant-numeric: tabular-nums; }
    .score strong { font-size: 17px; }
    @media (max-width: 480px) { .score { align-items: flex-start; } }
  `,
})
export class TrainingVersionsComponent implements OnInit {
  private readonly training = inject(TrainingApi);
  private readonly toast = inject(ToastService);
  readonly agentId = input.required<string>();
  readonly canEdit = input(false);
  readonly dirty = input(false);
  readonly published = output<void>();
  readonly changed = output<void>();

  readonly versions = signal<AgentVersion[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly publishing = signal<string | null>(null);
  readonly warnings = signal<string[]>([]);
  readonly bestId = computed(() => {
    let best: AgentVersion | null = null;
    for (const v of this.versions()) if (v.bestScore !== null && (!best || v.bestScore > best.bestScore!)) best = v;
    return best?.id ?? null;
  });
  note = '';

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const list = await this.training.versions(this.agentId());
      this.versions.set([...list].sort((a, b) => b.version - a.version));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async save() {
    this.saving.set(true);
    try {
      const v = await this.training.createVersion(this.agentId(), this.note.trim() || undefined);
      this.note = '';
      this.toast.success(`Versión v${v.version} guardada`);
      await this.load();
      this.changed.emit();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  async publish(v: AgentVersion) {
    const extra = this.dirty() ? ' Los cambios sin guardar del formulario se descartarán.' : '';
    if (!confirm(`¿Publicar la versión v${v.version}? Su configuración reemplazará la actual del agente (se guarda una versión previa).${extra}`)) return;
    this.publishing.set(v.id);
    this.warnings.set([]);
    try {
      const res = await this.training.publishVersion(this.agentId(), v.id);
      const warnings = Array.isArray(res?.warnings) ? res.warnings.filter((w): w is string => typeof w === 'string') : [];
      this.warnings.set(warnings);
      this.toast.success(`Versión v${v.version} publicada`);
      this.published.emit();
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.publishing.set(null);
    }
  }

  fmt(v: string) {
    return formatDateTime(v);
  }
}
