import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AccessApi } from '../../core/access.api';
import {
  type AgentShare,
  type AgentVisibility,
  PRINCIPAL_META,
  type SharePermission,
  type SharePrincipal,
  type UserGroupSummary,
  VISIBILITY_META,
} from '../../core/access.models';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { Agent, OrgMember, OrgUnitOption } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { treeOrder } from '../../shared/budget';
import { IconComponent } from '../../shared/icon.component';

type DraftShare = Omit<AgentShare, 'id'>;
const VISIBILITIES: AgentVisibility[] = ['PRIVATE', 'TEAM', 'WORKSPACE'];
const shareKey = (s: DraftShare) => `${s.principalType}:${s.principalId}`;
const memberLabel = (n: number) => `${n} ${n === 1 ? 'miembro' : 'miembros'}`;
const snapshot = (list: DraftShare[]) =>
  JSON.stringify(list.map((s) => [shareKey(s), s.permission]).sort((a, b) => a[0]!.localeCompare(b[0]!)));

/**
 * Diálogo «Compartir» (ADR 0007): visibilidad, permisos por persona, unidad o grupo (D6), «Publicar a un grupo»,
 * transferencia de propiedad y duplicado. Solo se abre con permiso EDIT sobre el agente. Los grupos requieren EDITOR+.
 */
@Component({
  selector: 'nx-agent-share-dialog',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agent-share-dialog.component.html',
  styleUrl: './agent-share-dialog.component.scss',
})
export class AgentShareDialogComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly access = inject(AccessApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  readonly agent = input.required<Agent>();
  readonly changed = output<Agent>();
  readonly closed = output<void>();

  readonly visibilities = VISIBILITIES;
  readonly meta = VISIBILITY_META;
  readonly principal = PRINCIPAL_META;
  readonly visibility = signal<AgentVisibility>('PRIVATE');
  readonly shares = signal<DraftShare[]>([]);
  readonly units = signal<{ item: OrgUnitOption; depth: number }[]>([]);
  readonly members = signal<OrgMember[] | null>(null);
  readonly unitsError = signal<string | null>(null);
  /** Grupos del workspace (`GET /groups`, EDITOR+); `null` si el rol no los ve o no se pudieron cargar. */
  readonly groups = signal<UserGroupSummary[] | null>(null);
  readonly groupsError = signal<string | null>(null);
  /** Grupo elegido en «Publicar a un grupo». */
  readonly publishGroupId = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  private saved = { visibility: 'PRIVATE' as AgentVisibility, shares: '[]' };

  // Formulario para agregar
  addType: SharePrincipal = 'UNIT';
  addId = '';
  addPermission: SharePermission = 'USE';
  transferTo = '';
  duplicateName = '';

  readonly launched = computed(() => this.agent().launchStatus === 'LAUNCHED');
  readonly canManageOwner = computed(() => this.agent().myPermission === 'OWNER' || this.auth.isAdmin());
  readonly sharingEnabled = computed(() => this.visibility() !== 'PRIVATE');
  readonly canUseGroups = computed(() => this.auth.canEdit());
  /** Tipos de destino disponibles según el rol: personas (ADMIN), unidades y grupos (EDITOR+). */
  readonly principalTypes = computed<SharePrincipal[]>(() => [
    ...(this.members() ? (['USER'] as const) : []),
    'UNIT',
    ...(this.groups() ? (['GROUP'] as const) : []),
  ]);
  readonly publishGroup = computed(() => this.groups()?.find((g) => g.id === this.publishGroupId()) ?? null);
  /** El grupo elegido ya está compartido (en el borrador) con el agente. */
  readonly publishAlreadyShared = computed(() =>
    this.shares().some((s) => s.principalType === 'GROUP' && s.principalId === this.publishGroupId()),
  );
  readonly transferCandidates = computed(() => {
    const ownerId = this.agent().ownerId;
    const list = this.members();
    if (list) return list.filter((m) => m.userId !== ownerId).map((m) => ({ id: m.userId, name: `${m.name} · ${m.email}` }));
    return this.shares()
      .filter((s) => s.principalType === 'USER' && s.principalId !== ownerId)
      .map((s) => ({ id: s.principalId, name: s.principalName }));
  });

  constructor() {
    afterNextRender(() => this.dialog().nativeElement.showModal());
  }

  async ngOnInit() {
    const a = this.agent();
    this.visibility.set(a.visibility ?? 'PRIVATE');
    this.shares.set((a.shares ?? []).map(({ principalType, principalId, principalName, permission }) => ({ principalType, principalId, principalName, permission })));
    this.saved = { visibility: this.visibility(), shares: snapshot(this.shares()) };
    this.duplicateName = `Copia de ${a.name}`;
    if (!this.auth.isAdmin()) this.addType = 'UNIT';
    const [units, members, groups] = await Promise.all([
      this.api.orgUnits().catch((e) => {
        this.unitsError.set(errorMessage(e));
        return [] as OrgUnitOption[];
      }),
      // Solo la administración puede listar personas; el resto comparte con unidades.
      this.auth.isAdmin() ? this.api.orgMembers().catch(() => null) : Promise.resolve(null),
      this.canUseGroups()
        ? this.access.groups().catch((e) => {
            this.groupsError.set(errorMessage(e));
            return null;
          })
        : Promise.resolve(null),
    ]);
    this.units.set(treeOrder(units, (u) => u.id, (u) => u.parentId));
    this.members.set(members);
    this.groups.set(groups ? [...groups].sort((a, b) => a.name.localeCompare(b.name, 'es')) : null);
    if (members) this.addType = 'USER';
  }

  visibilityDisabled(v: AgentVisibility): string | null {
    if (v === this.saved.visibility) return null;
    if (v !== 'PRIVATE' && !this.auth.canEdit()) return 'Su rol solo permite agentes personales.';
    if (v === 'WORKSPACE' && !this.launched()) return 'Lance el agente para compartirlo con toda la empresa.';
    return null;
  }

  dirty() {
    return this.visibility() !== this.saved.visibility || (this.sharingEnabled() && snapshot(this.shares()) !== this.saved.shares);
  }

  /** Opciones de personas, unidades o grupos aún no compartidos. */
  options(): { id: string; name: string }[] {
    const taken = new Set(this.shares().map(shareKey));
    if (this.addType === 'USER') {
      return (this.members() ?? [])
        .filter((m) => m.userId !== this.agent().ownerId && !taken.has(`USER:${m.userId}`))
        .map((m) => ({ id: m.userId, name: `${m.name} · ${m.email}` }));
    }
    if (this.addType === 'GROUP') {
      return (this.groups() ?? [])
        .filter((g) => !taken.has(`GROUP:${g.id}`))
        .map((g) => ({ id: g.id, name: `${g.name} (${memberLabel(g.memberCount)})` }));
    }
    return this.units()
      .filter((u) => !taken.has(`UNIT:${u.item.id}`))
      .map((u) => ({ id: u.item.id, name: `${'   '.repeat(u.depth)}${u.item.name}` }));
  }

  setType(t: SharePrincipal) {
    this.addType = t;
    this.addId = '';
  }

  add() {
    const opt = this.options().find((o) => o.id === this.addId);
    if (!opt) return;
    const name = this.principalName(this.addType, opt.id) ?? opt.name.trim();
    this.shares.update((l) => [...l, { principalType: this.addType, principalId: opt.id, principalName: name, permission: this.addPermission }]);
    this.addId = '';
  }

  private principalName(type: SharePrincipal, id: string): string | null {
    if (type === 'USER') return this.members()?.find((m) => m.userId === id)?.name ?? null;
    if (type === 'GROUP') return this.groups()?.find((g) => g.id === id)?.name ?? null;
    return null;
  }

  /** Detalle del destino en la lista de shares (p. ej. «Grupo · 12 miembros»). */
  shareDetail(s: DraftShare): string {
    if (s.principalType !== 'GROUP') return this.principal[s.principalType].detail;
    const g = this.groups()?.find((x) => x.id === s.principalId);
    return g ? `Grupo · ${memberLabel(g.memberCount)}` : 'Grupo';
  }

  /**
   * «Publicar a un grupo» en un paso: deja la visibilidad en Equipo y agrega el grupo con permiso Usar (si ya estaba
   * compartido se conserva su permiso). Guarda también los demás cambios pendientes del diálogo.
   */
  async publishToGroup() {
    const g = this.publishGroup();
    if (!g || this.busy()) return;
    if (!this.publishAlreadyShared()) {
      this.shares.update((l) => [...l, { principalType: 'GROUP', principalId: g.id, principalName: g.name, permission: 'USE' }]);
    }
    this.visibility.set('TEAM');
    const ok = await this.persist(`Agente publicado al grupo «${g.name}»`);
    if (ok) this.publishGroupId.set('');
  }

  setPermission(i: number, permission: SharePermission) {
    this.shares.update((l) => l.map((s, j) => (j === i ? { ...s, permission } : s)));
  }

  remove(i: number) {
    this.shares.update((l) => l.filter((_, j) => j !== i));
  }

  onCancel(ev: Event) {
    if (this.busy()) ev.preventDefault();
  }

  close() {
    if (!this.busy()) this.dialog().nativeElement.close();
  }

  async save() {
    if (this.busy() || !this.dirty()) return;
    await this.persist('Acceso al agente actualizado');
  }

  private async persist(successMessage: string): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    const id = this.agent().id;
    try {
      let agent: Agent | null = null;
      if (this.sharingEnabled() && snapshot(this.shares()) !== this.saved.shares) {
        agent = await this.access.setShares(
          id,
          this.shares().map(({ principalType, principalId, permission }) => ({ principalType, principalId, permission })),
        );
      }
      if (this.visibility() !== this.saved.visibility) agent = await this.access.setVisibility(id, this.visibility());
      this.toast.success(successMessage);
      if (agent) this.changed.emit(agent);
      this.busy.set(false);
      this.dialog().nativeElement.close();
      return true;
    } catch (e) {
      this.error.set(errorMessage(e));
      this.busy.set(false);
      return false;
    }
  }

  async transfer() {
    const target = this.transferCandidates().find((c) => c.id === this.transferTo);
    if (!target || this.busy()) return;
    if (!confirm(`¿Transferir la propiedad de «${this.agent().name}» a ${target.name}? Dejará de ser el dueño.`)) return;
    this.busy.set(true);
    try {
      const agent = await this.access.transfer(this.agent().id, target.id);
      this.toast.success('Propiedad transferida');
      this.changed.emit(agent);
      this.busy.set(false);
      this.dialog().nativeElement.close();
    } catch (e) {
      this.error.set(errorMessage(e));
      this.busy.set(false);
    }
  }

  async duplicate() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const copy = await this.access.duplicate(this.agent().id, this.duplicateName);
      this.toast.success('Copia creada en sus agentes (Personal)');
      this.busy.set(false);
      this.dialog().nativeElement.close();
      await this.router.navigate(['/agents', copy.id]);
    } catch (e) {
      this.error.set(errorMessage(e));
      this.busy.set(false);
    }
  }
}
