import { ChangeDetectionStrategy, Component, ElementRef, inject, input, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { StudioApi } from '../../core/studio.api';
import {
  KNOWLEDGE_FILE_EXTENSIONS,
  KNOWLEDGE_FILE_MAX_BYTES,
  type KnowledgeBase,
  type KnowledgeDocument,
  type KnowledgeSearchHit,
  type KnowledgeSourceType,
} from '../../core/studio.models';
import { ToastService } from '../../core/toast.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { NumberPipe } from '../../shared/usd.pipe';

const SOURCE_LABELS: Record<KnowledgeSourceType, string> = { TEXT: 'Texto', URL: 'URL', FILE: 'Archivo' };
const SOURCE_ICONS: Record<KnowledgeSourceType, string> = { TEXT: 'pencil', URL: 'link', FILE: 'file' };

@Component({
  selector: 'nx-knowledge-detail',
  imports: [
    FormsModule,
    RouterLink,
    IconComponent,
    RelativeTimePipe,
    NumberPipe,
    EmptyStateComponent,
    ErrorStateComponent,
    LoadingStateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './knowledge-detail.page.html',
  styleUrl: './knowledge-detail.page.scss',
})
export class KnowledgeDetailPage implements OnInit {
  private readonly studio = inject(StudioApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  readonly id = input.required<string>();
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  readonly sourceLabels = SOURCE_LABELS;
  readonly sourceIcons = SOURCE_ICONS;
  readonly accept = KNOWLEDGE_FILE_EXTENSIONS.join(',');
  readonly extensions = KNOWLEDGE_FILE_EXTENSIONS.join(' ');
  readonly maxMb = KNOWLEDGE_FILE_MAX_BYTES / 1024 / 1024;

  readonly kb = signal<KnowledgeBase | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly docs = signal<KnowledgeDocument[]>([]);
  readonly docsError = signal<string | null>(null);
  readonly editingMeta = signal(false);
  meta = { name: '', description: '' };

  // Agregar documento
  readonly mode = signal<'text' | 'url' | 'file'>('text');
  readonly adding = signal(false);
  draft = { title: '', text: '', url: '' };
  readonly file = signal<File | null>(null);
  readonly fileError = signal<string | null>(null);

  // Probador de búsqueda
  query = '';
  limit = 5;
  readonly searching = signal(false);
  readonly hits = signal<KnowledgeSearchHit[] | null>(null);
  readonly searchError = signal<string | null>(null);

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [kb, docs] = await Promise.all([this.studio.knowledgeBase(this.id()), this.studio.documents(this.id())]);
      this.kb.set(kb);
      this.docs.set(docs);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  private async refresh() {
    try {
      const [kb, docs] = await Promise.all([this.studio.knowledgeBase(this.id()), this.studio.documents(this.id())]);
      this.kb.set(kb);
      this.docs.set(docs);
      this.docsError.set(null);
    } catch (e) {
      this.docsError.set(errorMessage(e));
    }
  }

  // ----- Datos de la base -----

  editMeta() {
    const kb = this.kb();
    if (!kb) return;
    this.meta = { name: kb.name, description: kb.description ?? '' };
    this.editingMeta.set(true);
  }

  async saveMeta() {
    if (this.meta.name.trim().length < 2) return;
    try {
      this.kb.set(await this.studio.updateKnowledgeBase(this.id(), { name: this.meta.name.trim(), description: this.meta.description.trim() }));
      this.editingMeta.set(false);
      this.toast.success('Base actualizada');
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async removeBase() {
    const kb = this.kb();
    if (!kb) return;
    const usage = kb.agentCount ? ` Se quitará de ${kb.agentCount} ${kb.agentCount === 1 ? 'agente' : 'agentes'}.` : '';
    if (!confirm(`¿Eliminar la base «${kb.name}» con todos sus documentos?${usage}`)) return;
    try {
      await this.studio.deleteKnowledgeBase(kb.id);
      this.toast.success('Base eliminada');
      await this.router.navigate(['/knowledge']);
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  // ----- Documentos -----

  onFile(input: HTMLInputElement) {
    const f = input.files?.[0] ?? null;
    this.fileError.set(null);
    this.file.set(null);
    if (!f) return;
    const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
    if (!(KNOWLEDGE_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
      this.fileError.set(`Formato no admitido (${ext || 'sin extensión'}). Use ${this.extensions}.`);
      input.value = '';
      return;
    }
    if (f.size > KNOWLEDGE_FILE_MAX_BYTES) {
      this.fileError.set(`El archivo pesa ${(f.size / 1024 / 1024).toFixed(1)} MB; el máximo es ${this.maxMb} MB.`);
      input.value = '';
      return;
    }
    if (f.size === 0) {
      this.fileError.set('El archivo está vacío.');
      input.value = '';
      return;
    }
    this.file.set(f);
  }

  canAdd(): boolean {
    switch (this.mode()) {
      case 'text':
        return this.draft.title.trim().length > 0 && this.draft.text.trim().length > 0;
      case 'url':
        return /^https?:\/\/\S+$/i.test(this.draft.url.trim());
      case 'file':
        return !!this.file();
    }
  }

  async addDocument() {
    if (!this.canAdd() || this.adding()) return;
    this.adding.set(true);
    const title = this.draft.title.trim();
    try {
      let doc: KnowledgeDocument;
      switch (this.mode()) {
        case 'text':
          doc = await this.studio.addDocument(this.id(), { title, text: this.draft.text });
          break;
        case 'url':
          doc = await this.studio.addDocument(this.id(), title ? { title, url: this.draft.url.trim() } : { url: this.draft.url.trim() });
          break;
        case 'file':
          doc = await this.studio.uploadDocument(this.id(), this.file()!, title || undefined);
          break;
      }
      if (doc.status === 'FAILED') this.toast.error(`No se pudo procesar «${doc.title}»: ${doc.error ?? 'error desconocido'}`);
      else this.toast.success(`Documento agregado: ${doc.chunkCount} fragmentos`);
      this.draft = { title: '', text: '', url: '' };
      this.file.set(null);
      const el = this.fileInput()?.nativeElement;
      if (el) el.value = '';
      await this.refresh();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.adding.set(false);
    }
  }

  async removeDocument(d: KnowledgeDocument) {
    if (!confirm(`¿Eliminar el documento «${d.title}»?`)) return;
    try {
      await this.studio.deleteDocument(this.id(), d.id);
      this.docs.update((list) => list.filter((x) => x.id !== d.id));
      void this.refresh();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  isLink(source: string | null) {
    return !!source && /^https?:\/\//i.test(source);
  }

  // ----- Búsqueda -----

  async search() {
    const q = this.query.trim();
    if (!q || this.searching()) return;
    this.searching.set(true);
    this.searchError.set(null);
    try {
      this.hits.set(await this.studio.searchKnowledge(this.id(), q, this.limit));
    } catch (e) {
      this.searchError.set(errorMessage(e));
      this.hits.set(null);
    } finally {
      this.searching.set(false);
    }
  }

  /** Ancho relativo del puntaje respecto al mejor resultado (el ranking `ts_rank_cd` no está acotado). */
  scoreWidth(score: number): number {
    const max = Math.max(...(this.hits() ?? []).map((h) => h.score), 0);
    return max > 0 ? Math.max(4, (score / max) * 100) : 0;
  }
}
