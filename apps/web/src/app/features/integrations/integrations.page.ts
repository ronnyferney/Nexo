import { ChangeDetectionStrategy, Component, computed, DOCUMENT, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { IntegrationsApi } from '../../core/integrations.api';
import type { CatalogCategory } from '../../core/integrations.models';
import { ToastService } from '../../core/toast.service';
import { PageHeaderComponent } from '../../layout/page-header.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { WORKFLOW_TEMPLATES } from '../workflows/templates';
import { BrandLogoComponent } from './brand-logo.component';
import { CATEGORIES, type CatalogEntryView, categoryLabel, FEATURED_IDS, SECTION_PREVIEW } from './catalog-meta';
import { InstallWizardComponent } from './install-wizard.component';
import { IntegrationDetailComponent } from './integration-detail.component';
import { oauthProvider } from './integration-logos';

const LEAD_TEMPLATE = WORKFLOW_TEMPLATES.find((t) => t.id === 'lead-commercial')!;

interface Row {
  entry: CatalogEntryView;
  /** Operación que coincidió con la búsqueda cuando no coincide el nombre ni la descripción. */
  matchedOp: string | null;
}

interface Section {
  id: string;
  title: string;
  rows: Row[];
  installed?: boolean;
  kit?: boolean;
}

/** Galería del catálogo de conectores nativos y kit comercial (ADR 0005 D2). */
@Component({
  selector: 'nx-integrations',
  imports: [
    FormsModule,
    RouterLink,
    PageHeaderComponent,
    IconComponent,
    BrandLogoComponent,
    InstallWizardComponent,
    IntegrationDetailComponent,
    EmptyStateComponent,
    ErrorStateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './integrations.page.html',
  styleUrl: './integrations.page.scss',
})
export class IntegrationsPage implements OnInit {
  private readonly integrations = inject(IntegrationsApi);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);
  protected readonly auth = inject(AuthService);

  readonly leadTemplate = LEAD_TEMPLATE;
  readonly preview = SECTION_PREVIEW;
  readonly catalog = signal<CatalogEntryView[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly query = signal('');
  readonly category = signal<CatalogCategory | ''>('');
  /** Entrada abierta en el panel de detalle. */
  readonly detail = signal<CatalogEntryView | null>(null);
  /** Entrada en el asistente de instalación. */
  readonly selected = signal<CatalogEntryView | null>(null);
  readonly expanded = signal<ReadonlySet<string>>(new Set());
  readonly busy = signal<'kit' | 'flow' | null>(null);
  readonly kitSkills = signal<{ id: string; name: string }[] | null>(null);
  /** Fila que abrió el panel: recibe el foco al cerrar el asistente (el panel ya no existe para devolverlo). */
  private trigger: HTMLElement | null = null;

  /** Categorías con al menos una entrada, en el orden del design system, con su contador. */
  readonly categoryOptions = computed(() => {
    const counts = new Map<CatalogCategory, number>();
    for (const e of this.catalog()) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
    return CATEGORIES.filter((c) => counts.has(c.id)).map((c) => ({ ...c, count: counts.get(c.id)! }));
  });

  readonly filtering = computed(() => !!this.query().trim() || !!this.category());

  readonly rows = computed<Row[]>(() => {
    const q = normalize(this.query().trim());
    const cat = this.category();
    const out: Row[] = [];
    for (const e of this.catalog()) {
      if (cat && e.category !== cat) continue;
      if (!q) {
        out.push({ entry: e, matchedOp: null });
        continue;
      }
      const head = normalize([e.name, e.description, categoryLabel(e.category)].join(' ')).includes(q);
      const op = head ? null : e.operations.find((o) => normalize(`${o.name} ${o.key}`).includes(q));
      if (head || op) out.push({ entry: e, matchedOp: op?.name ?? null });
    }
    return out;
  });

  readonly sections = computed<Section[]>(() => {
    const rows = this.rows();
    const out: Section[] = [];
    if (!this.filtering()) {
      const installed = rows.filter((r) => r.entry.installed > 0);
      if (installed.length) out.push({ id: 'installed', title: 'Instaladas', rows: installed, installed: true });
      const byId = new Map(rows.map((r) => [r.entry.id, r]));
      const featured = FEATURED_IDS.map((id) => byId.get(id)).filter((r): r is Row => !!r);
      if (featured.length) out.push({ id: 'featured', title: 'Más usadas', rows: featured });
    }
    let kitPlaced = false;
    for (const c of CATEGORIES) {
      const list = rows.filter((r) => r.entry.category === c.id);
      if (!list.length) continue;
      const kit: boolean = !kitPlaced && !this.query().trim() && (c.id === 'CRM' || c.id === 'PROSPECCION');
      kitPlaced ||= kit;
      out.push({ id: c.id, title: c.label, rows: list, kit });
    }
    return out;
  });

  private readonly route = inject(ActivatedRoute);

  async ngOnInit() {
    // Vuelta del enlace de aprobación de administrador de Microsoft (lo abrió TI): se informa y se limpia la URL.
    const consent = this.route.snapshot.queryParamMap.get('admin_consent');
    if (consent) {
      if (consent === 'ok') this.toast.success('El administrador aprobó la app. Ya puede conectar las cuentas.');
      else this.toast.error('No se completó la aprobación del administrador. Pida a TI que abra el enlace de nuevo.');
      void this.router.navigate([], { queryParams: { admin_consent: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
    await this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.catalog.set((await this.integrations.catalog()) as CatalogEntryView[]);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  toggle(id: string) {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  clearFilters() {
    this.query.set('');
    this.category.set('');
  }

  openDetail(e: CatalogEntryView, ev: Event) {
    this.trigger = ev.currentTarget as HTMLElement;
    this.detail.set(e);
  }

  startInstall(e: CatalogEntryView) {
    this.detail.set(null);
    this.selected.set(e);
  }

  wizardClosed() {
    this.selected.set(null);
    const t = this.trigger;
    if (t?.isConnected) setTimeout(() => t.focus());
  }

  oauthLabel(e: CatalogEntryView) {
    return e.authMethods.includes('oauth2_code') ? oauthProvider(e) : null;
  }

  skillNames(skills: { name: string }[]) {
    return skills.map((s) => s.name).join(', ');
  }

  async installKit() {
    this.busy.set('kit');
    try {
      const res = await this.integrations.installCommercialKit();
      const skills = Array.isArray(res?.skills) ? res.skills : [];
      this.kitSkills.set(skills);
      this.toast.success(skills.length ? `${skills.length} skills comerciales listas` : 'Kit comercial instalado');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  async createLeadWorkflow() {
    const t = this.leadTemplate;
    this.busy.set('flow');
    try {
      const wf = await this.api.createWorkflow({ name: 'Calificación de leads entrantes', description: t.description, definition: structuredClone(t.definition) });
      this.toast.success('Flujo creado. Elija las operaciones y el agente en los nodos pendientes.');
      await this.router.navigate(['/workflows', wf.id]);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  /** Lleva el foco a la primera fila recién revelada al expandir una sección (navegación con teclado). */
  focusRow(sectionId: string, index: number) {
    setTimeout(() => this.document.getElementById(`row-${sectionId}-${index}`)?.focus());
  }
}

function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
