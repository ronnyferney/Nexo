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
  type SharePermission,
  type SharePrincipal,
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
const snapshot = (list: DraftShare[]) =>
  JSON.stringify(list.map((s) => [shareKey(s), s.permission]).sort((a, b) => a[0]!.localeCompare(b[0]!)));

/**
 * Diálogo «Compartir» (ADR 0007): visibilidad, permisos por persona o unidad, transferencia de propiedad y duplicado.
 * Solo se abre con permiso EDIT sobre el agente.
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
  readonly visibility = signal<AgentVisibility>('PRIVATE');
  readonly shares = signal<DraftShare[]>([]);
  readonly units = signal<{ item: OrgUnitOption; depth: number }[]>([]);
  readonly members = signal<OrgMember[] | null>(null);
  readonly unitsError = signal<string | null>(null);
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
    const [units, members] = await Promise.all([
      this.api.orgUnits().catch((e) => {
        this.unitsError.set(errorMessage(e));
        return [] as OrgUnitOption[];
      }),
      // Solo la administración puede listar personas; el resto comparte con unidades.
      this.auth.isAdmin() ? this.api.orgMembers().catch(() => null) : Promise.resolve(null),
    ]);
    this.units.set(treeOrder(units, (u) => u.id, (u) => u.parentId));
    this.members.set(members);
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

  /** Opciones de personas o unidades aún no compartidas. */
  options(): { id: string; name: string }[] {
    const taken = new Set(this.shares().map(shareKey));
    if (this.addType === 'USER') {
      return (this.members() ?? [])
        .filter((m) => m.userId !== this.agent().ownerId && !taken.has(`USER:${m.userId}`))
        .map((m) => ({ id: m.userId, name: `${m.name} · ${m.email}` }));
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
    const name = this.addType === 'USER' ? (this.members()?.find((m) => m.userId === opt.id)?.name ?? opt.name) : opt.name.trim();
    this.shares.update((l) => [...l, { principalType: this.addType, principalId: opt.id, principalName: name, permission: this.addPermission }]);
    this.addId = '';
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
      this.toast.success('Acceso al agente actualizado');
      if (agent) this.changed.emit(agent);
      this.busy.set(false);
      this.dialog().nativeElement.close();
    } catch (e) {
      this.error.set(errorMessage(e));
      this.busy.set(false);
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
