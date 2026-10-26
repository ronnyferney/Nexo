import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth.service';
import { GovernanceApi } from '../../core/governance.api';
import type { ApprovalDecisionKind, Aprobacion } from '../../core/governance.models';
import { errorMessage } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import {
  APPROVAL_STATUS_META,
  approvalsRemaining,
  canDecide,
  DECISION_LABEL,
  distinctApprovers,
  isDecidable,
  isInvalidatedOrExpired,
  isRequester,
  RISK_META,
} from './governance.util';

/** Bandeja de aprobaciones (E6 · RF12). Lista + detalle que compara la propuesta con su estado de gobierno. */
@Component({
  selector: 'nx-aprobaciones',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, RelativeTimePipe],
  templateUrl: './aprobaciones.page.html',
  styles: `
    .drawer-backdrop { position: fixed; inset: 0; background: rgba(8, 16, 45, 0.45); z-index: 40; }
    .drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(760px, 100vw); background: var(--bg); border-left: 1px solid var(--border); box-shadow: var(--shadow); z-index: 41; display: flex; flex-direction: column; }
    .drawer-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 20px; border-bottom: 1px solid var(--border); }
    .drawer-head h2 { margin: 0; font-size: 18px; }
    .drawer-body { overflow-y: auto; padding: 18px 20px; }
    .kv { display: grid; grid-template-columns: 150px 1fr; gap: 10px; align-items: start; }
    .kv .k, .k { font-size: 12.5px; font-weight: 600; color: var(--muted); }
    .kv .v { min-width: 0; word-break: break-word; }
    .hash { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; }
    .decisions { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .decisions li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    pre.code-block { margin: 4px 0 0; white-space: pre-wrap; word-break: break-word; }
    @media (max-width: 640px) { .kv { grid-template-columns: 1fr; gap: 2px; } }
  `,
})
export class AprobacionesPage implements OnInit {
  private readonly api = inject(GovernanceApi);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  readonly statusMeta = APPROVAL_STATUS_META;
  readonly riskMeta = RISK_META;
  readonly decisionLabel = DECISION_LABEL;
  readonly estados = ['PENDIENTE', 'APROBADA', 'RECHAZADA', 'AJUSTE', 'EJECUTADA', 'CADUCADA', 'INVALIDADA'] as const;

  readonly items = signal<Aprobacion[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly estadoFiltro = signal<string>('');
  readonly selected = signal<Aprobacion | null>(null);
  readonly deciding = signal(false);
  readonly comentario = signal('');

  readonly userId = computed(() => this.auth.me()?.id ?? null);
  readonly canEdit = computed(() => this.auth.canEdit());
  readonly pendientes = computed(() => this.items().filter((a) => a.estado === 'PENDIENTE').length);

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.items.set(await this.api.approvals(this.estadoFiltro() || undefined));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async open(a: Aprobacion) {
    this.comentario.set('');
    this.selected.set(a);
    try {
      // Detalle fresco por si cambió el estado desde que se cargó la lista.
      this.selected.set(await this.api.approval(a.id));
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  close() {
    this.selected.set(null);
  }

  // ---------- Presentación ----------

  isRequester = (a: Aprobacion) => isRequester(a.solicitanteUserId, this.userId());
  isDecidable = (a: Aprobacion) => isDecidable(a.estado);
  invalidada = (a: Aprobacion) => isInvalidatedOrExpired(a.estado, a.expiresAt);
  aprobadores = (a: Aprobacion) => distinctApprovers(a.decisiones);
  faltan = (a: Aprobacion) => approvalsRemaining(a.decisiones, a.requiredApprovals);

  importeTexto(a: Aprobacion): string | null {
    if (a.importe === null || a.importe === undefined || a.importe === '') return null;
    return `${a.importe}${a.moneda ? ' ' + a.moneda : ''}`;
  }

  /** JSON legible y acotado para mostrar contenido/operación sin ejecutar nada. */
  pretty(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  hasKeys(value: unknown): boolean {
    return !!value && typeof value === 'object' && Object.keys(value as object).length > 0;
  }

  gate(a: Aprobacion, decision: ApprovalDecisionKind) {
    return canDecide({
      estado: a.estado,
      expiresAt: a.expiresAt,
      solicitanteUserId: a.solicitanteUserId,
      allowSelfApproval: a.allowSelfApproval,
      decisiones: a.decisiones,
      userId: this.userId(),
      canEdit: this.canEdit(),
      decision,
    });
  }

  gateMsg(a: Aprobacion, decision: ApprovalDecisionKind): string | null {
    const g = this.gate(a, decision);
    return g.ok ? null : g.mensaje;
  }

  // ---------- Decisiones ----------

  async decide(a: Aprobacion, decision: ApprovalDecisionKind) {
    const g = this.gate(a, decision);
    if (!g.ok) {
      this.toast.error(g.mensaje);
      return;
    }
    const comentario = this.comentario().trim();
    if (decision === 'AJUSTE' && !comentario) {
      this.toast.error('Indique en el comentario qué debe ajustarse.');
      return;
    }
    this.deciding.set(true);
    try {
      const actualizada = await this.api.decideApproval(a.id, { decision, comentario: comentario || undefined });
      this.selected.set(actualizada);
      this.comentario.set('');
      this.toast.success(`Decisión registrada: ${this.decisionLabel[decision].toLowerCase()}`);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.deciding.set(false);
    }
  }
}
