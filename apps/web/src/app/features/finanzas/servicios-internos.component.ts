import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../core/api.service';
import { ImputacionApi } from '../../core/imputacion.api';
import type { ClienteInterno, ServicioInterno } from '../../core/imputacion.models';
import type { EstadoEstructura } from '../../core/estructura.models';
import type { Agent, OrgMember, OrgUnit } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { ListEditorComponent } from '../../shared/list-editor.component';
import { IconComponent } from '../../shared/icon.component';
import { ESTADO_META, badgeClass, empresaNombre, validarVigencia } from '../admin/estructura/estructura.util';
import { EditorRepartoComponent } from './editor-reparto.component';

interface Draft {
  id: string | null;
  empresaId: string;
  areaDuenoId: string;
  codigo: string;
  nombre: string;
  responsableUserId: string | null;
  responsableAgentId: string | null;
  entradas: string;
  salidas: string;
  criterios: string;
  clientes: string[];
  estado: EstadoEstructura;
  vigenteDesde: string;
  vigenteHasta: string;
}

/** Áreas (OrgUnit) de una empresa: la propia empresa y sus unidades, para elegir el área dueña y los destinos. */
export function areasDeEmpresa(units: OrgUnit[], empresaId: string): OrgUnit[] {
  if (!empresaId) return [];
  return units
    .filter((u) => u.id === empresaId || u.empresaId === empresaId)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

const toString = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Servicios internos / compartidos (ADR 0011 D5 · E9 · RF44) y acceso a su editor de reparto (RF45). Lista por empresa,
 * crear/editar (área dueña, código/nombre, responsables, acuerdo de servicio, clientes internos, estado/vigencia) y
 * abrir el reparto. Editar requiere EDITOR+ (el servidor es el gate real). No concede acceso a datos (D6).
 */
@Component({
  selector: 'nx-servicios-internos',
  imports: [
    FormsModule,
    IconComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    LoadingStateComponent,
    ListEditorComponent,
    EditorRepartoComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './servicios-internos.component.html',
})
export class ServiciosInternosComponent implements OnInit {
  private readonly imputacion = inject(ImputacionApi);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly empresas = input.required<OrgUnit[]>();
  readonly units = input.required<OrgUnit[]>();
  readonly canEdit = input<boolean>(false);

  readonly estados: EstadoEstructura[] = ['ACTIVA', 'SUSPENDIDA', 'CERRADA'];
  readonly estadoMeta = ESTADO_META;
  readonly badgeClass = badgeClass;
  readonly areasDeEmpresa = areasDeEmpresa;

  readonly items = signal<ServicioInterno[]>([]);
  readonly members = signal<OrgMember[]>([]);
  readonly agents = signal<Agent[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly filtro = signal<string>('');
  readonly draft = signal<Draft | null>(null);
  readonly busy = signal(false);
  /** Servicio cuyo reparto se está editando (abre el editor de reparto). */
  readonly reparto = signal<ServicioInterno | null>(null);

  readonly memberName = computed(() => new Map(this.members().map((m) => [m.userId, m.name])));
  readonly agentName = computed(() => new Map(this.agents().map((a) => [a.id, a.name])));
  /** Áreas de la empresa seleccionada en el formulario (para el selector de área dueña). */
  readonly areasDraft = computed(() => areasDeEmpresa(this.units(), this.draft()?.empresaId ?? ''));

  ngOnInit() {
    void this.load();
    void this.loadRefs();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.items.set(await this.imputacion.servicios(this.filtro() || undefined));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadRefs() {
    const [members, agents] = await Promise.all([
      this.api.orgMembers().catch(() => [] as OrgMember[]),
      this.api.agents().catch(() => [] as Agent[]),
    ]);
    this.members.set(members);
    this.agents.set(agents);
  }

  onFiltro(v: string) {
    this.filtro.set(v);
    void this.load();
  }

  empresaDe(id: string) {
    return empresaNombre(this.empresas(), id);
  }

  areaDe(id: string) {
    return this.units().find((u) => u.id === id)?.name ?? '—';
  }

  responsable(userId: string | null) {
    return (userId && this.memberName().get(userId)) || '—';
  }

  agente(agentId: string | null) {
    return (agentId && this.agentName().get(agentId)) || '—';
  }

  clientesLabel(clientes: ClienteInterno[]): string {
    return clientes?.length ? clientes.map((c) => c.nombre).join(', ') : '—';
  }

  startCreate() {
    const empresaId = this.filtro() || this.empresas()[0]?.id || '';
    this.draft.set({
      id: null,
      empresaId,
      areaDuenoId: '',
      codigo: '',
      nombre: '',
      responsableUserId: null,
      responsableAgentId: null,
      entradas: '',
      salidas: '',
      criterios: '',
      clientes: [],
      estado: 'ACTIVA',
      vigenteDesde: '',
      vigenteHasta: '',
    });
  }

  startEdit(s: ServicioInterno) {
    const acuerdo = s.acuerdoServicio ?? {};
    this.draft.set({
      id: s.id,
      empresaId: s.empresaId,
      areaDuenoId: s.areaDuenoId,
      codigo: s.codigo,
      nombre: s.nombre,
      responsableUserId: s.responsableUserId,
      responsableAgentId: s.responsableAgentId,
      entradas: toString(acuerdo['entradas']),
      salidas: toString(acuerdo['salidas']),
      criterios: toString(acuerdo['criterios']),
      clientes: (s.clientesInternos ?? []).map((c) => c.nombre).filter(Boolean),
      estado: s.estado,
      vigenteDesde: s.vigenteDesde?.slice(0, 10) ?? '',
      vigenteHasta: s.vigenteHasta?.slice(0, 10) ?? '',
    });
  }

  invalid(d: Draft) {
    return !d.empresaId || !d.areaDuenoId || d.codigo.trim().length < 1 || d.nombre.trim().length < 2;
  }

  async save() {
    const d = this.draft();
    if (!d || this.invalid(d)) return;
    const err = validarVigencia(d.vigenteDesde || null, d.vigenteHasta || null);
    if (err) {
      this.toast.error(err);
      return;
    }
    this.busy.set(true);
    try {
      const acuerdoServicio: Record<string, string> = {};
      if (d.entradas.trim()) acuerdoServicio['entradas'] = d.entradas.trim();
      if (d.salidas.trim()) acuerdoServicio['salidas'] = d.salidas.trim();
      if (d.criterios.trim()) acuerdoServicio['criterios'] = d.criterios.trim();
      const body = {
        areaDuenoId: d.areaDuenoId,
        codigo: d.codigo.trim(),
        nombre: d.nombre.trim(),
        responsableUserId: d.responsableUserId || null,
        responsableAgentId: d.responsableAgentId || null,
        acuerdoServicio,
        clientesInternos: d.clientes.map((nombre) => ({ nombre })),
        estado: d.estado,
        vigenteDesde: d.vigenteDesde || null,
        vigenteHasta: d.vigenteHasta || null,
      };
      if (d.id) await this.imputacion.updateServicio(d.id, body);
      else await this.imputacion.createServicio({ empresaId: d.empresaId, ...body });
      this.toast.success(d.id ? 'Servicio actualizado' : 'Servicio creado');
      this.draft.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async remove(s: ServicioInterno) {
    if (!confirm(`¿Eliminar el servicio interno "${s.nombre}"? Se borrará también su reparto.`)) return;
    try {
      await this.imputacion.deleteServicio(s.id);
      this.toast.success('Servicio eliminado');
      if (this.draft()?.id === s.id) this.draft.set(null);
      if (this.reparto()?.id === s.id) this.reparto.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  openReparto(s: ServicioInterno) {
    this.reparto.set(s);
  }
}
