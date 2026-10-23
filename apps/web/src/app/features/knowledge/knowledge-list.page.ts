import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { StudioApi } from '../../core/studio.api';
import type { KnowledgeBase } from '../../core/studio.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { NumberPipe } from '../../shared/usd.pipe';

@Component({
  selector: 'nx-knowledge-list',
  imports: [FormsModule, RouterLink, IconComponent, RelativeTimePipe, NumberPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div><h1>Conocimiento</h1><p>Bases de documentos de su empresa que los agentes consultan para responder con información propia</p></div>
        @if (auth.canEdit()) {
          <button class="btn primary" (click)="creating.set(!creating())"><nx-icon name="plus" />Nueva base</button>
        }
      </div>

      @if (creating()) {
        <form class="card editor stack" style="margin-bottom:20px" (ngSubmit)="create()">
          <h2>Nueva base de conocimiento</h2>
          <div class="grid grid-2">
            <div class="field"><label for="kb-name">Nombre</label>
              <input id="kb-name" class="input" name="name" required [(ngModel)]="name" placeholder="Ej. Políticas comerciales" /></div>
            <div class="field"><label for="kb-desc">Descripción (opcional)</label>
              <input id="kb-desc" class="input" name="description" [(ngModel)]="description" placeholder="Qué contiene y para qué sirve" /></div>
          </div>
          <div class="row"><span class="spacer"></span>
            <button type="button" class="btn" (click)="creating.set(false)">Cancelar</button>
            <button type="submit" class="btn primary" [disabled]="busy() || name.trim().length < 2">Crear base</button></div>
        </form>
      }

      @if (loading()) {
        <div class="card empty"><p>Cargando bases de conocimiento…</p></div>
      } @else if (error()) {
        <div class="card empty"><nx-icon name="alert" [size]="28" /><h3>No se pudieron cargar las bases</h3><p>{{ error() }}</p>
          <button class="btn" (click)="load()">Reintentar</button></div>
      } @else if (bases().length) {
        <div class="cards">
          @for (k of bases(); track k.id) {
            <a class="card hover kb" [routerLink]="['/knowledge', k.id]">
              <div class="card-title"><div class="icon-tile"><nx-icon name="book" /></div><h3>{{ k.name }}</h3></div>
              <p class="muted small">{{ k.description || 'Sin descripción' }}</p>
              <div class="row wrap small stats">
                <span class="badge">{{ k.documentCount | num }} documentos</span>
                <span class="badge">{{ k.chunkCount | num }} fragmentos</span>
                <span class="badge" [class.primary]="k.agentCount > 0">{{ k.agentCount }} {{ k.agentCount === 1 ? 'agente' : 'agentes' }}</span>
              </div>
              <div class="row small muted"><span class="spacer"></span><span>{{ k.updatedAt | ago }}</span></div>
            </a>
          }
        </div>
      } @else {
        <div class="card empty"><nx-icon name="book" [size]="36" /><h3>Sin bases de conocimiento</h3>
          <p>Cree una base, cargue documentos (texto, URL o archivos) y asígnela a sus agentes.</p></div>
      }
    </div>
  `,
  styles: `a.kb { color: inherit; display: flex; flex-direction: column; gap: 8px; } a.kb p { margin: 0; } .stats { gap: 6px; }`,
})
export class KnowledgeListPage implements OnInit {
  private readonly studio = inject(StudioApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  readonly bases = signal<KnowledgeBase[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly creating = signal(false);
  readonly busy = signal(false);
  name = '';
  description = '';

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.bases.set(await this.studio.knowledgeBases());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async create() {
    if (this.name.trim().length < 2) return;
    this.busy.set(true);
    try {
      const kb = await this.studio.createKnowledgeBase({ name: this.name.trim(), description: this.description.trim() || undefined });
      await this.router.navigate(['/knowledge', kb.id]);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
