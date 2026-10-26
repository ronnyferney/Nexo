import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.service';
import { GovernanceApi } from '../../core/governance.api';
import type {
  DecisionPolitica,
  PolicyEffect,
  PolicySelector,
  Politica,
  PoliticaInput,
} from '../../core/governance.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { EFFECT_META, POLICY_STATUS_META } from './governance.util';

/** Tipos de acción habituales (RF13/§5). Texto abierto: el usuario puede escribir otros. */
const TIPOS_ACCION = [
  'EMAIL_SEND',
  'WHATSAPP_SEND',
  'VOICE_CALL',
  'PAYMENT',
  'BANK_ACCOUNT_CHANGE',
  'DATA_DELETE',
  'PERMISSION_CHANGE',
  'EXTERNAL_PUBLISH',
  'RPA_RUN',
  'WEB_FETCH',
];

interface PoliticaDraft {
  id: string | null;
  nombre: string;
  tipoAccion: string;
  empresaId: string;
  efecto: PolicyEffect;
  requiredApprovals: number;
  allowSelfApproval: boolean;
  estado: Politica['estado'];
  selDestinatarios: string;
  selAgentes: string;
  selConectores: string;
  selMontoMin: number | null;
  selMontoMax: number | null;
  selHoraDesde: number | null;
  selHoraHasta: number | null;
  selDias: string;
}

/** Políticas versionadas (E6 · RF11, ADMIN). CRUD + auditoría de decisiones registradas. */
@Component({
  selector: 'nx-politicas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, RelativeTimePipe],
  templateUrl: './politicas.page.html',
  styles: `
    .mono-sel { font-size: 12px; }
    pre.code-block { margin: 0; white-space: pre-wrap; word-break: break-word; }
    .ver { font-variant-numeric: tabular-nums; }
  `,
})
export class PoliticasPage implements OnInit {
  private readonly api = inject(GovernanceApi);
  private readonly toast = inject(ToastService);

  readonly tiposAccion = TIPOS_ACCION;
  readonly efectos: PolicyEffect[] = ['ALLOW', 'REQUIRE_APPROVAL', 'DENY'];
  readonly estadosPol: Politica['estado'][] = ['ACTIVA', 'BORRADOR', 'ARCHIVADA'];
  readonly effectMeta = EFFECT_META;
  readonly statusMeta = POLICY_STATUS_META;

  readonly tab = signal<'politicas' | 'decisiones'>('politicas');
  readonly items = signal<Politica[]>([]);
  readonly decisiones = signal<DecisionPolitica[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly estadoFiltro = signal<string>('ACTIVA');
  readonly draft = signal<PoliticaDraft | null>(null);
  readonly saving = signal(false);

  readonly activas = computed(() => this.items().filter((p) => p.estado === 'ACTIVA').length);

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.items.set(await this.api.policies({ estado: this.estadoFiltro() || undefined }));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async showDecisions() {
    this.tab.set('decisiones');
    if (this.decisiones().length) return;
    try {
      this.decisiones.set(await this.api.policyDecisions());
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  nueva() {
    this.draft.set({
      id: null,
      nombre: '',
      tipoAccion: '',
      empresaId: '',
      efecto: 'REQUIRE_APPROVAL',
      requiredApprovals: 1,
      allowSelfApproval: false,
      estado: 'ACTIVA',
      selDestinatarios: '',
      selAgentes: '',
      selConectores: '',
      selMontoMin: null,
      selMontoMax: null,
      selHoraDesde: null,
      selHoraHasta: null,
      selDias: '',
    });
  }

  editar(p: Politica) {
    const s = p.selector ?? {};
    this.draft.set({
      id: p.id,
      nombre: p.nombre,
      tipoAccion: p.tipoAccion,
      empresaId: p.empresaId ?? '',
      efecto: p.efecto,
      requiredApprovals: p.requiredApprovals,
      allowSelfApproval: p.allowSelfApproval,
      estado: p.estado,
      selDestinatarios: (s.destinatarios ?? []).join(', '),
      selAgentes: (s.agentIds ?? []).join(', '),
      selConectores: (s.conectorIds ?? []).join(', '),
      selMontoMin: s.montoMin ?? null,
      selMontoMax: s.montoMax ?? null,
      selHoraDesde: s.horario?.desde ?? null,
      selHoraHasta: s.horario?.hasta ?? null,
      selDias: (s.horario?.dias ?? []).join(', '),
    });
  }

  effectLabel = (e: PolicyEffect) => this.effectMeta[e].label;
  selectorResumen(p: Politica): string {
    const s = p.selector ?? {};
    const parts: string[] = [];
    if (s.destinatarios?.length) parts.push(`destinatarios: ${s.destinatarios.join(', ')}`);
    if (s.montoMin != null || s.montoMax != null) parts.push(`monto: ${s.montoMin ?? '0'}–${s.montoMax ?? '∞'}`);
    if (s.horario?.desde != null || s.horario?.hasta != null) parts.push(`horario: ${s.horario?.desde ?? 0}h–${s.horario?.hasta ?? 23}h`);
    if (s.agentIds?.length) parts.push(`${s.agentIds.length} agente(s)`);
    if (s.conectorIds?.length) parts.push(`${s.conectorIds.length} conector(es)`);
    return parts.length ? parts.join(' · ') : 'Todas las acciones de este tipo';
  }

  private csv(text: string): string[] {
    return text.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
  }

  private buildSelector(d: PoliticaDraft): PolicySelector {
    const sel: PolicySelector = {};
    const dest = this.csv(d.selDestinatarios);
    const ag = this.csv(d.selAgentes);
    const con = this.csv(d.selConectores);
    if (dest.length) sel.destinatarios = dest;
    if (ag.length) sel.agentIds = ag;
    if (con.length) sel.conectorIds = con;
    if (d.selMontoMin != null) sel.montoMin = Number(d.selMontoMin);
    if (d.selMontoMax != null) sel.montoMax = Number(d.selMontoMax);
    const dias = this.csv(d.selDias).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    const horario: NonNullable<PolicySelector['horario']> = {};
    if (d.selHoraDesde != null) horario.desde = Number(d.selHoraDesde);
    if (d.selHoraHasta != null) horario.hasta = Number(d.selHoraHasta);
    if (dias.length) horario.dias = dias;
    if (Object.keys(horario).length) sel.horario = horario;
    return sel;
  }

  invalid(d: PoliticaDraft): boolean {
    return d.nombre.trim().length < 2 || d.tipoAccion.trim().length < 2;
  }

  async guardar() {
    const d = this.draft();
    if (!d || this.invalid(d)) return;
    const body: PoliticaInput = {
      nombre: d.nombre.trim(),
      tipoAccion: d.tipoAccion.trim(),
      empresaId: d.empresaId.trim() || null,
      efecto: d.efecto,
      selector: this.buildSelector(d),
      estado: d.estado,
      ...(d.efecto === 'REQUIRE_APPROVAL'
        ? { requiredApprovals: d.requiredApprovals, allowSelfApproval: d.allowSelfApproval }
        : {}),
    };
    this.saving.set(true);
    try {
      if (d.id) {
        await this.api.updatePolicy(d.id, body);
        this.toast.success('Política actualizada (nueva versión creada)');
      } else {
        await this.api.createPolicy(body);
        this.toast.success('Política creada');
      }
      this.draft.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  async archivar(p: Politica) {
    if (!confirm(`¿Archivar la política "${p.nombre}" (v${p.version})? Dejará de aplicarse a nuevas acciones.`)) return;
    try {
      await this.api.archivePolicy(p.id);
      this.toast.success('Política archivada');
      if (this.draft()?.id === p.id) this.draft.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
