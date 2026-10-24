import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ModelSpecialty } from '../../core/llm-providers.models';
import type { ModelTier } from '../../core/models';
import { TIER_LABELS } from '../../shared/budget';
import { IconComponent } from '../../shared/icon.component';
import { formatUsd } from '../../shared/usd.pipe';
import type { BrandLogo } from '../integrations/integration-logos';
import { BrandLogoComponent } from '../integrations/brand-logo.component';
import {
  COST_OPTIONS,
  formatContext,
  matchesMemory,
  MEMORY_OPTIONS,
  type MemoryFilter,
  normalize,
  SPECIALTIES,
  SPECIALTY_LABELS,
} from './provider-meta';

export interface DetailModel {
  key: string;
  label: string;
  modelId: string;
  tier: ModelTier;
  specialties: ModelSpecialty[];
  contextTokens: number | null;
  input: number | null;
  output: number | null;
  enabled: boolean;
  /** Sin tarifa configurada (importado sin precio verificado): no cuenta en presupuestos hasta completarla. */
  needsPricing?: boolean;
  /** Modelo local (Ollama, LM Studio): sin costo por token. */
  local?: boolean;
  /** Fabricante del modelo en enrutadores (OpenRouter, Groq, Hugging Face); si falta se usa el del proveedor. */
  vendor?: { name: string; logo: BrandLogo } | null;
}

/** Datos del diálogo de un proveedor conectado (los arma la página desde la tarjeta y sus modelos). */
export interface ProviderDetailData {
  key: string;
  title: string;
  entry: { id: string; name: string };
  logo: BrandLogo;
  status: 'on' | 'off' | 'missing';
  statusLabel: string;
  /** Pie: «Sesión iniciada con X», «Conectado con clave de API», «Incluido por Nexo»… */
  footLabel: string;
  /** Conectado por inicio de sesión (OAuth o código): el botón dice «Cerrar sesión» en lugar de «Desconectar». */
  signedIn: boolean;
  /** Estado del token OAuth: «La sesión se renueva automáticamente» o cuándo volver a iniciar sesión. */
  sessionNote: string | null;
  /** Sesión cerrada (conexión OAuth sin tokens): se ofrece «Iniciar sesión de nuevo». */
  signedOut: boolean;
  /** Se puede volver a iniciar sesión sobre la misma conexión (OAuth o código de dispositivo disponible). */
  canReauth: boolean;
  canDisconnect: boolean;
  models: DetailModel[];
}

/** Diálogo «<Proveedor> · N modelos · ● Conectado» con buscador y filtros de especialidad, costo y memoria. */
@Component({
  selector: 'nx-provider-detail',
  imports: [FormsModule, IconComponent, BrandLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './provider-detail.component.html',
  styleUrl: './provider-detail.component.scss',
})
export class ProviderDetailComponent {
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  readonly data = input.required<ProviderDetailData>();
  readonly closed = output<void>();
  /** Desconectar (clave de API) o eliminar la conexión. */
  readonly disconnect = output<void>();
  /** Cerrar sesión conservando la conexión. */
  readonly signOut = output<void>();
  /** Volver a iniciar sesión en la misma conexión. */
  readonly reauth = output<void>();
  readonly goModels = output<void>();

  readonly specialties = SPECIALTIES;
  readonly specialtyLabels = SPECIALTY_LABELS;
  readonly costOptions = COST_OPTIONS;
  readonly memoryOptions = MEMORY_OPTIONS;
  readonly tierLabels = TIER_LABELS;

  readonly query = signal('');
  readonly specialty = signal<ModelSpecialty | ''>('');
  readonly cost = signal<ModelTier | ''>('');
  readonly memory = signal<MemoryFilter | ''>('');

  readonly filtering = computed(() => !!(this.query().trim() || this.specialty() || this.cost() || this.memory()));
  readonly count = computed(() => {
    const n = this.data().models.length;
    return `${n} ${n === 1 ? 'modelo' : 'modelos'}`;
  });

  readonly filtered = computed(() => {
    const q = normalize(this.query().trim());
    const sp = this.specialty();
    const c = this.cost();
    const mem = this.memory();
    return this.data().models.filter(
      (m) =>
        (!sp || m.specialties.includes(sp)) &&
        (!c || m.tier === c) &&
        matchesMemory(m.contextTokens, mem) &&
        (!q || normalize(`${m.label} ${m.modelId}`).includes(q)),
    );
  });

  constructor() {
    afterNextRender(() => {
      const dlg = this.dialog().nativeElement;
      dlg.showModal();
      dlg.querySelector<HTMLElement>('#pd-search')?.focus();
    });
  }

  close() {
    this.dialog().nativeElement.close();
  }

  clearFilters() {
    this.query.set('');
    this.specialty.set('');
    this.cost.set('');
    this.memory.set('');
  }

  meta(m: DetailModel) {
    const parts: string[] = [m.vendor ? `${m.vendor.name} vía ${this.data().title}` : this.data().title];
    const ctx = formatContext(m.contextTokens);
    if (ctx) parts.push(`${ctx} de memoria`);
    const sp = m.specialties.filter((s) => s !== 'GENERAL').map((s) => SPECIALTY_LABELS[s]);
    if (sp.length) parts.push(sp.join(', '));
    return parts.join(' · ');
  }

  price(m: DetailModel) {
    if (m.local) return 'Local · sin costo por uso';
    if (m.needsPricing || m.input == null || m.output == null || (m.input === 0 && m.output === 0)) {
      return 'Tarifa por configurar';
    }
    return `${formatUsd(m.input)} / ${formatUsd(m.output)}`;
  }

  tierClass(t: ModelTier) {
    return t === 'PREMIUM' ? 'primary' : t === 'ECONOMY' ? 'success' : 'info';
  }
}
