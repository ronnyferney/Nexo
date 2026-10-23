import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.service';
import { PlatformApi } from '../../core/platform.api';
import type { CopilotFeedbackItem } from '../../core/platform.models';
import { DateRangeComponent, isoDay } from '../../shared/date-range.component';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { NumberPipe } from '../../shared/usd.pipe';
import { PlatformNavComponent } from './platform-nav.component';
import { SatisfactionDonutComponent } from './satisfaction-donut.component';

type RatingFilter = 'ALL' | 'UP' | 'DOWN';
const PAGE_SIZE = 30;
const DAY_FMT = new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short' });

/** Consola de plataforma: calidad del Copilot a partir de las calificaciones de los usuarios (ADR 0006 D6). */
@Component({
  selector: 'nx-platform-quality',
  imports: [FormsModule, IconComponent, DateRangeComponent, RelativeTimePipe, NumberPipe, PlatformNavComponent, SatisfactionDonutComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div><h1>Plataforma Nexo</h1><p>Calidad del Copilot: calificaciones, comentarios y conversaciones compartidas</p></div>
        <nx-date-range [(range)]="range" />
      </div>
      <nx-platform-nav />

      @if (error()) {
        <div class="card empty"><nx-icon name="alert" [size]="28" /><h3>No se pudieron cargar las calificaciones</h3><p>{{ error() }}</p>
          <button class="btn" (click)="load()">Reintentar</button></div>
      } @else if (loading()) {
        <div class="card empty"><p>Cargando…</p></div>
      } @else {
        <div class="grid grid-2">
          <div class="card row" style="gap:18px; align-items:center">
            <nx-satisfaction-donut [up]="stats().up" [down]="stats().down" />
            <div class="stack" style="gap:4px">
              <strong>Satisfacción en el período</strong>
              <span class="small">👍 {{ stats().up | num }} · 👎 {{ stats().down | num }}</span>
              <span class="muted small">{{ stats().comments | num }} con comentario · {{ stats().shared | num }} con conversación compartida</span>
            </div>
          </div>
          <div class="card stack">
            <div class="card-title"><h2>Calificaciones por día</h2></div>
            @if (days().length) {
              <div class="vbars" style="height:120px" role="img" [attr.aria-label]="'Calificaciones por día en el período'">
                @for (d of days(); track d.day; let i = $index) {
                  <div class="vbar" [title]="d.label + ': ' + d.up + ' positivas, ' + d.down + ' negativas'">
                    <div class="vbar-track">
                      <span class="stack" [style.height.%]="((d.up + d.down) / maxDay()) * 100">
                        <i class="up" [style.flex-grow]="d.up"></i><i class="down" [style.flex-grow]="d.down"></i>
                      </span>
                    </div>
                    <small [style.visibility]="i % labelStep() === 0 ? 'visible' : 'hidden'">{{ d.label }}</small>
                  </div>
                }
              </div>
            } @else {
              <p class="muted small">Sin calificaciones en el período.</p>
            }
          </div>
        </div>

        <div class="card" style="margin-top:16px">
          <div class="row wrap" style="margin-bottom:12px">
            <div class="segmented" role="group" aria-label="Filtrar por calificación">
              @for (f of ratingFilters; track f.id) {
                <button type="button" [class.active]="rating() === f.id" [attr.aria-pressed]="rating() === f.id" (click)="setRating(f.id)">{{ f.label }}</button>
              }
            </div>
            <label class="checkbox small"><input type="checkbox" [ngModel]="onlyComments()" (ngModelChange)="onlyComments.set($event); limit.set(pageSize)" />Con comentario</label>
            <label class="checkbox small"><input type="checkbox" [ngModel]="onlyShared()" (ngModelChange)="onlyShared.set($event); limit.set(pageSize)" />Con conversación compartida</label>
            <span class="spacer"></span>
            <input class="input" type="search" style="max-width:260px" placeholder="Buscar en comentarios o workspace" aria-label="Buscar calificaciones"
              [ngModel]="query()" (ngModelChange)="query.set($event ?? ''); limit.set(pageSize)" />
          </div>

          @if (filtered().length) {
            <ul class="feedback-list">
              @for (f of visible(); track f.id) {
                <li class="feedback-item">
                  <div class="row wrap small">
                    <span class="badge" [class.success]="f.rating === 'UP'" [class.danger]="f.rating === 'DOWN'">
                      <span aria-hidden="true">{{ f.rating === 'UP' ? '👍' : '👎' }}</span>{{ f.rating === 'UP' ? 'Positiva' : 'Negativa' }}</span>
                    @if (workspaceOf(f); as w) { <span><nx-icon name="building" [size]="13" /> {{ w }}</span> }
                    @if (f.copilotVersion) { <span class="badge mono">{{ f.copilotVersion }}</span> }
                    <span class="spacer"></span><span class="muted">{{ f.createdAt | ago }}</span>
                  </div>
                  @if (f.comment) { <p style="margin:8px 0 0">{{ f.comment }}</p> } @else { <p class="muted small" style="margin:8px 0 0">Sin comentario.</p> }
                  @if (f.messageText) {
                    <blockquote class="rated-message small">{{ f.messageText }}</blockquote>
                  }
                  @if (f.sharedConversation?.length) {
                    <details class="shared-conv">
                      <summary class="small">Conversación compartida por el usuario ({{ f.sharedConversation!.length }} mensajes)</summary>
                      <div class="stack" style="gap:6px; margin-top:8px">
                        @for (m of f.sharedConversation!; track $index) {
                          <div class="conv-msg" [class.user]="m.role === 'user'"><strong class="small">{{ m.role === 'user' ? 'Usuario' : 'Copilot' }}</strong>
                            <div class="small">{{ m.text }}</div></div>
                        }
                      </div>
                    </details>
                  }
                </li>
              }
            </ul>
            @if (filtered().length > visible().length) {
              <div class="row" style="justify-content:center; margin-top:12px">
                <button class="btn" (click)="limit.set(limit() + pageSize)">Ver más ({{ filtered().length - visible().length }} restantes)</button>
              </div>
            }
          } @else {
            <div class="empty"><nx-icon name="inbox" [size]="32" /><h3>Sin calificaciones</h3><p>No hay calificaciones que coincidan con los filtros.</p></div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .feedback-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .feedback-item { padding: 14px 4px; border-bottom: 1px solid var(--border); }
    .feedback-item:last-child { border-bottom: 0; }
    .rated-message { margin: 8px 0 0; padding: 8px 12px; border-left: 3px solid var(--border); color: var(--muted); white-space: pre-wrap; max-height: 140px; overflow: auto; }
    .shared-conv { margin-top: 8px; }
    .shared-conv summary { cursor: pointer; color: var(--primary); font-weight: 550; }
    .conv-msg { padding: 8px 10px; border-radius: 8px; background: var(--surface-2); white-space: pre-wrap; }
    .conv-msg.user { background: var(--primary-50); }
    .vbars { overflow: hidden; gap: 2px; }
    .vbar { flex: 1 1 0; min-width: 2px; }
    .vbar > small { overflow: visible; }
    .vbar-track > span.stack { display: flex; flex-direction: column; background: none; min-height: 0; overflow: hidden; }
    .stack > i { display: block; flex-basis: 0; min-height: 0; }
    .stack > i.up { background: var(--success); }
    .stack > i.down { background: var(--danger); }
    .vbar:hover .vbar-track > span.stack { background: none; }
  `,
})
export class PlatformQualityPage implements OnInit {
  private readonly api = inject(PlatformApi);
  readonly range = this.api.range;
  readonly items = signal<CopilotFeedbackItem[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rating = signal<RatingFilter>('ALL');
  readonly onlyComments = signal(false);
  readonly onlyShared = signal(false);
  readonly query = signal('');
  readonly pageSize = PAGE_SIZE;
  readonly limit = signal(PAGE_SIZE);
  readonly ratingFilters: { id: RatingFilter; label: string }[] = [
    { id: 'ALL', label: 'Todas' },
    { id: 'UP', label: '👍 Positivas' },
    { id: 'DOWN', label: '👎 Negativas' },
  ];

  /** Calificaciones dentro del rango (el contrato no recibe fechas: se filtra en el cliente). */
  readonly inRange = computed(() => {
    const { from, to } = this.range();
    return this.items().filter((f) => {
      const day = isoDay(new Date(f.createdAt));
      return day >= from && day <= to;
    });
  });

  readonly stats = computed(() => {
    const list = this.inRange();
    return {
      up: list.filter((f) => f.rating === 'UP').length,
      down: list.filter((f) => f.rating === 'DOWN').length,
      comments: list.filter((f) => !!f.comment?.trim()).length,
      shared: list.filter((f) => !!f.sharedConversation?.length).length,
    };
  });

  readonly days = computed(() => {
    const { from, to } = this.range();
    const buckets = new Map<string, { up: number; down: number }>();
    for (const f of this.inRange()) {
      const day = isoDay(new Date(f.createdAt));
      const b = buckets.get(day) ?? { up: 0, down: 0 };
      if (f.rating === 'UP') b.up++;
      else b.down++;
      buckets.set(day, b);
    }
    if (!buckets.size) return [];
    const out: { day: string; label: string; up: number; down: number }[] = [];
    const cursor = new Date(`${from}T00:00:00`);
    // Como máximo 120 barras para mantener legible el gráfico.
    while (isoDay(cursor) <= to && out.length < 120) {
      const day = isoDay(cursor);
      const b = buckets.get(day) ?? { up: 0, down: 0 };
      out.push({ day, label: DAY_FMT.format(cursor), ...b });
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  });
  /** Una etiqueta cada N días para que el eje no se sature (máx. ~12 etiquetas). */
  readonly labelStep = computed(() => Math.max(1, Math.ceil(this.days().length / 12)));
  readonly maxDay = computed(() => Math.max(1, ...this.days().map((d) => d.up + d.down)));

  readonly filtered = computed(() => {
    const r = this.rating();
    const q = this.query().trim().toLowerCase();
    const comments = this.onlyComments();
    const shared = this.onlyShared();
    return this.inRange()
      .filter(
        (f) =>
          (r === 'ALL' || f.rating === r) &&
          (!comments || !!f.comment?.trim()) &&
          (!shared || !!f.sharedConversation?.length) &&
          (!q || [f.comment ?? '', this.workspaceOf(f) ?? '', f.messageText ?? ''].some((v) => v.toLowerCase().includes(q))),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
  readonly visible = computed(() => this.filtered().slice(0, this.limit()));

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.items.set(await this.api.feedback());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  setRating(r: RatingFilter) {
    this.rating.set(r);
    this.limit.set(PAGE_SIZE);
  }

  workspaceOf(f: CopilotFeedbackItem): string | null {
    return f.workspace?.name ?? f.workspaceName ?? f.workspaceId ?? null;
  }
}
