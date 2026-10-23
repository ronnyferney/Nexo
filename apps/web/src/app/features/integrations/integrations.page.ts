import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { IntegrationsApi } from '../../core/integrations.api';
import type { CatalogCategory, CatalogEntry } from '../../core/integrations.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { isHttpUrl } from '../../shared/safe-url';
import { WORKFLOW_TEMPLATES } from '../workflows/templates';
import { CATEGORIES, catalogLogo, categoryLabel } from './catalog-meta';
import { InstallWizardComponent } from './install-wizard.component';

const LEAD_TEMPLATE = WORKFLOW_TEMPLATES.find((t) => t.id === 'lead-commercial')!;

/** Galería del catálogo de conectores nativos y kit comercial (ADR 0005 D2). */
@Component({
  selector: 'nx-integrations',
  imports: [FormsModule, RouterLink, IconComponent, InstallWizardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div><h1>Integraciones</h1><p>Instale conectores listos para usar: credenciales en la bóveda y operaciones prediseñadas para agentes y flujos.</p></div>
        <a class="btn" routerLink="/connectors"><nx-icon name="plug" />Mis conectores</a>
      </div>

      <section class="card kit" aria-labelledby="kit-title">
        <div class="icon-tile kit-icon"><nx-icon name="rocket" [size]="22" /></div>
        <div class="kit-body stack">
          <div><span class="badge primary">Destacado</span>
            <h2 id="kit-title">Kit comercial</h2>
            <p class="muted">Skills de prospección, calificación BANT, seguimiento de oportunidades y preparación de reunión, más la plantilla
              de flujo «{{ leadTemplate.name }}». Combínelo con Lusha y su CRM.</p></div>
          @if (kitSkills(); as ks) {
            <div class="callout info" role="status"><nx-icon name="checkCircle" [size]="16" />
              <span>{{ ks.length ? ks.length + ' skills listas: ' + skillNames(ks) + '.' : 'Skills comerciales listas.' }}
                <a routerLink="/skills">Ver skills</a></span></div>
          }
          @if (auth.canEdit()) {
            <div class="row wrap">
              <button class="btn primary" [disabled]="busy()" (click)="installKit()">
                <nx-icon name="sparkles" [size]="16" />{{ busy() === 'kit' ? 'Instalando…' : kitSkills() ? 'Reinstalar skills' : 'Instalar skills comerciales' }}</button>
              <button class="btn" [disabled]="busy()" (click)="createLeadWorkflow()">
                <nx-icon name="flow" [size]="16" />{{ busy() === 'flow' ? 'Creando…' : 'Crear flujo de leads' }}</button>
            </div>
          } @else {
            <p class="small muted">Solicite a un editor que instale el kit en este workspace.</p>
          }
        </div>
      </section>

      <div class="filters">
        <label class="sr-only" for="int-search">Buscar integraciones</label>
        <div class="search"><nx-icon name="search" [size]="16" />
          <input id="int-search" class="input" type="search" placeholder="Buscar integración u operación" [ngModel]="query()" (ngModelChange)="query.set($event)" /></div>
        <div class="row wrap cats" role="group" aria-label="Filtrar por categoría">
          <button class="btn sm" [class.primary]="!category()" [attr.aria-pressed]="!category()" (click)="category.set(null)">Todas</button>
          @for (c of categories; track c.id) {
            <button class="btn sm" [class.primary]="category() === c.id" [attr.aria-pressed]="category() === c.id" (click)="category.set(c.id)">
              <nx-icon [name]="c.icon" [size]="14" />{{ c.label }}@if (counts()[c.id]) { <span class="count">{{ counts()[c.id] }}</span> }</button>
          }
        </div>
      </div>

      @if (loading()) {
        <div class="cards" aria-busy="true"><span class="sr-only" role="status">Cargando catálogo…</span>
          @for (i of [1, 2, 3]; track i) { <div class="card skeleton"></div> }</div>
      } @else if (error()) {
        <div class="card empty" role="alert"><nx-icon name="alert" [size]="32" /><h3>No se pudo cargar el catálogo</h3><p>{{ error() }}</p>
          <button class="btn" (click)="load()"><nx-icon name="refresh" />Reintentar</button></div>
      } @else if (!catalog().length) {
        <div class="card empty"><nx-icon name="puzzle" [size]="36" /><h3>Catálogo vacío</h3><p>Aún no hay integraciones disponibles. Puede crear un conector manualmente.</p></div>
      } @else if (!filtered().length) {
        <div class="card empty"><nx-icon name="search" [size]="32" /><h3>Sin resultados</h3><p>Ninguna integración coincide con el filtro.</p>
          <button class="btn" (click)="clearFilters()">Limpiar filtros</button></div>
      } @else {
        <p class="sr-only" role="status">{{ filtered().length }} integraciones</p>
        <div class="cards">
          @for (e of filtered(); track e.id) {
            @let logo = logoOf(e);
            <article class="card entry" [attr.aria-labelledby]="'ce-' + e.id">
              <div class="card-title">
                <div class="icon-tile">@if (logo.img) { <img [src]="logo.img" alt="" width="22" height="22" /> } @else { <nx-icon [name]="logo.icon" /> }</div>
                <div class="grow"><h3 [id]="'ce-' + e.id">{{ e.name }}</h3>
                  <span class="row wrap tags"><span class="badge">{{ categoryLabel(e.category) }}</span>
                    @if (e.installed) { <span class="badge success"><span class="dot"></span>{{ e.installed }} {{ e.installed === 1 ? 'instalada' : 'instaladas' }}</span> }</span></div>
              </div>
              <p class="muted small desc">{{ e.description }}</p>
              <details>
                <summary class="small">{{ e.operations.length }} {{ e.operations.length === 1 ? 'operación incluida' : 'operaciones incluidas' }}</summary>
                <ul class="ops small">@for (op of e.operations; track op.key) { <li><strong>{{ op.name }}</strong><span class="muted"> — {{ op.description }}</span></li> }</ul>
              </details>
              <div class="row foot">
                @if (isHttp(e.docsUrl)) {
                  <a class="small" [href]="e.docsUrl" target="_blank" rel="noopener noreferrer">Documentación<span class="sr-only"> de {{ e.name }} (abre en otra pestaña)</span> <nx-icon name="externalLink" [size]="12" /></a>
                }
                <span class="spacer"></span>
                @if (auth.canEdit()) {
                  <button class="btn sm primary" (click)="selected.set(e)" [attr.aria-label]="'Instalar ' + e.name"><nx-icon name="plus" [size]="14" />Instalar</button>
                }
              </div>
            </article>
          }
        </div>
      }
    </div>
    @if (selected(); as s) { <nx-install-wizard [entry]="s" (closed)="selected.set(null)" /> }
  `,
  styles: `
    .kit { display: flex; gap: 16px; margin-bottom: 20px; border-color: var(--primary); background: linear-gradient(135deg, var(--primary-50), var(--surface) 70%); }
    .kit h2 { margin: 6px 0 4px; }
    .kit p { margin: 0; }
    .kit-icon { width: 48px; height: 48px; border-radius: 14px; }
    .kit-body { flex: 1; min-width: 0; }
    .filters { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; }
    .search { position: relative; flex: 1 1 260px; }
    .search nx-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--muted); }
    .search .input { padding-left: 34px; }
    .cats { gap: 6px; }
    .count { font-size: 11px; opacity: 0.75; }
    .entry { display: flex; flex-direction: column; gap: 10px; }
    .entry .card-title { margin: 0; align-items: flex-start; }
    .grow { flex: 1; min-width: 0; }
    .tags { gap: 6px; margin-top: 4px; }
    .desc { margin: 0; flex: 1; }
    details summary { cursor: pointer; color: var(--primary); font-weight: 550; }
    .ops { margin: 8px 0 0; padding-left: 18px; display: grid; gap: 4px; }
    .foot { gap: 8px; }
    .foot a { display: inline-flex; align-items: center; gap: 4px; }
    .skeleton { height: 190px; background: var(--surface-2); animation: pulse 1.2s ease-in-out infinite; }
    img { object-fit: contain; }
    @keyframes pulse { 50% { opacity: 0.5; } }
    @media (max-width: 600px) { .kit { flex-direction: column; } }
    @media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } }
  `,
})
export class IntegrationsPage implements OnInit {
  private readonly integrations = inject(IntegrationsApi);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);

  readonly categories = CATEGORIES;
  readonly leadTemplate = LEAD_TEMPLATE;
  readonly catalog = signal<CatalogEntry[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly query = signal('');
  readonly category = signal<CatalogCategory | null>(null);
  readonly selected = signal<CatalogEntry | null>(null);
  readonly busy = signal<'kit' | 'flow' | null>(null);
  readonly kitSkills = signal<{ id: string; name: string }[] | null>(null);

  readonly counts = computed(() => {
    const out: Partial<Record<CatalogCategory, number>> = {};
    for (const e of this.catalog()) out[e.category] = (out[e.category] ?? 0) + 1;
    return out;
  });

  readonly filtered = computed(() => {
    const q = normalize(this.query().trim());
    const cat = this.category();
    return this.catalog().filter(
      (e) =>
        (!cat || e.category === cat) &&
        (!q ||
          normalize([e.name, e.description, categoryLabel(e.category), ...e.operations.map((o) => o.name)].join(' ')).includes(q)),
    );
  });

  logoOf = catalogLogo;
  categoryLabel = categoryLabel;
  isHttp = isHttpUrl;

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.catalog.set(await this.integrations.catalog());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  clearFilters() {
    this.query.set('');
    this.category.set(null);
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
}

function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
