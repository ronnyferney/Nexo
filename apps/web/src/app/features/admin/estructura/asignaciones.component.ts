import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/api.service';
import { EstructuraApi } from '../../../core/estructura.api';
import type {
  AsignacionCreateInput,
  AsignacionOrganizacional,
  LineaNegocio,
  Sede,
  TipoAsignacion,
} from '../../../core/estructura.models';
import { TIPOS_ASIGNACION } from '../../../core/estructura.models';
import type { Agent, OrgMember, OrgUnit } from '../../../core/models';
import { ToastService } from '../../../core/toast.service';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { LoadingStateComponent } from '../../../shared/loading-state.component';
import { IconComponent } from '../../../shared/icon.component';
import {
  TIPO_ASIGNACION_META,
  asignacionVigente,
  badgeClass,
  destinoField,
  tipoAsignacionLabel,
  validarVigencia,
} from './estructura.util';

interface Draft {
  sujeto: 'agent' | 'user';
  agentId: string;
  userId: string;
  tipoAsignacion: TipoAsignacion;
  orgUnitId: string;
  lineaNegocioId: string;
  sedeId: string;
  proyectoId: string;
  rol: string;
  vigenteDesde: string;
  vigenteHasta: string;
}

/**
 * Matriz de asignaciones (ADR 0011 D4/RF42): relaciona un sujeto (agente o miembro) con una dimensión destino (área,
 * línea, sede o proyecto) con alcance y vigencia, sin duplicar el agente. Cerrar una asignación conserva el historial.
 * NO concede acceso a datos (D6). Crear/cerrar: EDITOR+.
 */
@Component({
  selector: 'nx-asignaciones',
  imports: [FormsModule, IconComponent, EmptyStateComponent, ErrorStateComponent, LoadingStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './asignaciones.component.html',
})
export class AsignacionesComponent implements OnInit {
  private readonly estructura = inject(EstructuraApi);
  private readonly toast = inject(ToastService);

  readonly units = input.required<OrgUnit[]>();
  readonly empresas = input.required<OrgUnit[]>();
  readonly agents = input.required<Agent[]>();
  readonly members = input.required<OrgMember[]>();
  readonly canEdit = input<boolean>(false);

  readonly tipos = TIPOS_ASIGNACION;
  readonly tipoMeta = TIPO_ASIGNACION_META;
  readonly tipoLabel = tipoAsignacionLabel;
  readonly badgeClass = badgeClass;
  readonly asignacionVigente = asignacionVigente;

  readonly items = signal<AsignacionOrganizacional[]>([]);
  readonly lineas = signal<LineaNegocio[]>([]);
  readonly sedes = signal<Sede[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  /** `true` = solo vigentes; `false` = incluye el historial (cerradas). */
  readonly soloVigentes = signal(true);
  readonly draft = signal<Draft | null>(null);
  readonly busy = signal(false);

  readonly agentName = computed(() => new Map(this.agents().map((a) => [a.id, a.name])));
  readonly memberName = computed(() => new Map(this.members().map((m) => [m.userId, m.name])));
  readonly unitName = computed(() => new Map(this.units().map((u) => [u.id, u.name])));
  readonly lineaName = computed(() => new Map(this.lineas().map((l) => [l.id, l.nombre])));
  readonly sedeName = computed(() => new Map(this.sedes().map((s) => [s.id, s.nombre])));

  readonly visibles = computed(() =>
    this.soloVigentes() ? this.items().filter((a) => asignacionVigente(a)) : this.items(),
  );

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [items, lineas, sedes] = await Promise.all([
        this.estructura.asignaciones(),
        this.estructura.lineas().catch(() => [] as LineaNegocio[]),
        this.estructura.sedes().catch(() => [] as Sede[]),
      ]);
      this.items.set(items);
      this.lineas.set(lineas);
      this.sedes.set(sedes);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  sujetoNombre(a: AsignacionOrganizacional): string {
    if (a.agentId) return this.agentName().get(a.agentId) ?? 'Agente';
    if (a.userId) return this.memberName().get(a.userId) ?? 'Miembro';
    return '—';
  }

  sujetoTipo(a: AsignacionOrganizacional): 'Agente' | 'Persona' {
    return a.agentId ? 'Agente' : 'Persona';
  }

  destinoNombre(a: AsignacionOrganizacional): string {
    if (a.lineaNegocioId) return this.lineaName().get(a.lineaNegocioId) ?? 'Línea';
    if (a.sedeId) return this.sedeName().get(a.sedeId) ?? 'Sede';
    if (a.orgUnitId) return this.unitName().get(a.orgUnitId) ?? 'Unidad';
    if (a.proyectoId) return a.proyectoId;
    return '—';
  }

  fmtDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es', { dateStyle: 'medium' });
  }

  startCreate() {
    this.draft.set({
      sujeto: 'agent',
      agentId: this.agents()[0]?.id ?? '',
      userId: this.members()[0]?.userId ?? '',
      tipoAsignacion: 'FUNCIONAL_PRINCIPAL',
      orgUnitId: '',
      lineaNegocioId: '',
      sedeId: '',
      proyectoId: '',
      rol: '',
      vigenteDesde: '',
      vigenteHasta: '',
    });
  }

  /** Campo destino requerido por el tipo seleccionado (para mostrar el selector correcto). */
  destinoDe(tipo: TipoAsignacion) {
    return destinoField(tipo);
  }

  invalid(d: Draft): boolean {
    if (d.sujeto === 'agent' ? !d.agentId : !d.userId) return true;
    const campo = destinoField(d.tipoAsignacion);
    return !d[campo];
  }

  async save() {
    const d = this.draft();
    if (!d || this.invalid(d)) return;
    const err = validarVigencia(d.vigenteDesde || null, d.vigenteHasta || null);
    if (err) {
      this.toast.error(err);
      return;
    }
    const campo = destinoField(d.tipoAsignacion);
    const body: AsignacionCreateInput = {
      ...(d.sujeto === 'agent' ? { agentId: d.agentId } : { userId: d.userId }),
      tipoAsignacion: d.tipoAsignacion,
      [campo]: d[campo],
      ...(d.rol.trim() ? { rol: d.rol.trim() } : {}),
      ...(d.vigenteDesde ? { vigenteDesde: d.vigenteDesde } : {}),
      ...(d.vigenteHasta ? { vigenteHasta: d.vigenteHasta } : {}),
    };
    this.busy.set(true);
    try {
      await this.estructura.createAsignacion(body);
      this.toast.success('Asignación creada');
      this.draft.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** Cierra una asignación: pone fin de vigencia hoy y estado CERRADA. Conserva el historial (D4). */
  async cerrar(a: AsignacionOrganizacional) {
    if (!confirm(`¿Cerrar la asignación de ${this.sujetoNombre(a)}? Se conservará en el historial.`)) return;
    try {
      await this.estructura.updateAsignacion(a.id, {
        estado: 'CERRADA',
        vigenteHasta: new Date().toISOString(),
      });
      this.toast.success('Asignación cerrada');
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
