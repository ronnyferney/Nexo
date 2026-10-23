import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { OrgMember, OrgUnit, ProviderInfo, Role } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { ROLE_LABELS, treeOrder } from '../../shared/budget';
import { IconComponent } from '../../shared/icon.component';

interface UnitDraft {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
  isRoot: boolean;
  allowedModels: string[];
  original: OrgUnit;
}

interface MemberDraft {
  email: string;
  name: string;
  role: Role;
  orgUnitId: string;
  password: string;
}

@Component({
  selector: 'nx-admin-organization',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './organization.page.html',
})
export class OrganizationPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);

  readonly roleLabels = ROLE_LABELS;
  readonly roles = computed<Role[]>(() =>
    this.auth.session()?.role === 'OWNER' ? ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'] : ['ADMIN', 'EDITOR', 'VIEWER'],
  );

  readonly units = signal<OrgUnit[]>([]);
  readonly members = signal<OrgMember[]>([]);
  readonly catalog = signal<ProviderInfo[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly membersError = signal<string | null>(null);

  readonly tree = computed(() => treeOrder(this.units(), (u) => u.id, (u) => u.parentId));
  readonly unitById = computed(() => new Map(this.units().map((u) => [u.id, u])));
  readonly root = computed(() => this.units().find((u) => u.isRoot) ?? null);
  /** Opciones `"<providerId>:<modelId>"` a partir del catálogo habilitado. */
  readonly modelOptions = computed(() =>
    this.catalog().flatMap((p) => p.models.map((m) => ({ value: `${p.id}:${m.id}`, provider: p.label, label: m.label }))),
  );

  readonly editing = signal<UnitDraft | null>(null);
  readonly creating = signal<{ parentId: string; name: string; code: string } | null>(null);
  readonly busy = signal(false);
  readonly memberDraft = signal<MemberDraft | null>(null);

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    this.membersError.set(null);
    try {
      const [units, catalog] = await Promise.all([this.api.adminOrgUnits(), this.api.llmCatalog().catch(() => [])]);
      this.units.set(units);
      this.catalog.set(catalog);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
    await this.loadMembers();
  }

  async loadMembers() {
    try {
      this.members.set(await this.api.orgMembers());
      this.membersError.set(null);
    } catch (e) {
      this.membersError.set(errorMessage(e));
    }
  }

  unitName(id: string | null) {
    return (id && this.unitById().get(id)?.name) || '—';
  }

  // ----- Unidades -----

  startCreate(parentId: string) {
    this.editing.set(null);
    this.creating.set({ parentId, name: '', code: '' });
  }

  async create() {
    const d = this.creating();
    if (!d || d.name.trim().length < 2) return;
    this.busy.set(true);
    try {
      await this.api.createOrgUnit({ name: d.name.trim(), parentId: d.parentId, ...(d.code.trim() ? { code: d.code.trim() } : {}) });
      this.toast.success('Unidad creada');
      this.creating.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  startEdit(u: OrgUnit) {
    this.creating.set(null);
    this.editing.set({
      id: u.id,
      name: u.name,
      code: u.code ?? '',
      parentId: u.parentId,
      isRoot: u.isRoot,
      allowedModels: [...u.allowedModels],
      original: u,
    });
  }

  /** Posibles padres: todas las unidades excepto la propia y sus descendientes (evita ciclos). */
  parentOptions(unitId: string) {
    const blocked = new Set<string>([unitId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const u of this.units()) {
        if (u.parentId && blocked.has(u.parentId) && !blocked.has(u.id)) {
          blocked.add(u.id);
          grew = true;
        }
      }
    }
    return this.tree().filter((t) => !blocked.has(t.item.id));
  }

  /** Incluye valores guardados que ya no están en el catálogo para no perderlos en silencio. */
  allowedOptions(d: UnitDraft) {
    const known = new Set(this.modelOptions().map((o) => o.value));
    const extra = d.allowedModels.filter((v) => !known.has(v)).map((v) => ({ value: v, provider: 'No disponible', label: v }));
    return [...this.modelOptions(), ...extra];
  }

  toggleAllowed(d: UnitDraft, value: string, on: boolean) {
    const set = new Set(d.allowedModels);
    if (on) set.add(value);
    else set.delete(value);
    this.editing.set({ ...d, allowedModels: [...set] });
  }

  async saveEdit() {
    const d = this.editing();
    if (!d || d.name.trim().length < 2) return;
    this.busy.set(true);
    try {
      const o = d.original;
      const code = d.code.trim();
      await this.api.updateOrgUnit(d.id, {
        name: d.name.trim(),
        ...(code !== (o.code ?? '') ? { code: code || null } : {}),
        ...(!d.isRoot && d.parentId && d.parentId !== o.parentId ? { parentId: d.parentId } : {}),
        allowedModels: d.allowedModels,
      });
      this.toast.success('Unidad actualizada');
      this.editing.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async removeUnit(u: OrgUnit) {
    if (u.isRoot) return;
    if (!confirm(`¿Eliminar la unidad "${u.name}"? Sus subunidades y miembros pasarán a "${this.unitName(u.parentId)}".`)) return;
    try {
      await this.api.deleteOrgUnit(u.id);
      this.toast.success('Unidad eliminada');
      if (this.editing()?.id === u.id) this.editing.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  // ----- Miembros -----

  startAddMember() {
    this.memberDraft.set({ email: '', name: '', role: 'EDITOR', orgUnitId: this.root()?.id ?? '', password: '' });
  }

  memberInvalid(d: MemberDraft) {
    return !/^\S+@\S+\.\S+$/.test(d.email.trim()) || d.name.trim().length < 2 || (!!d.password && d.password.length < 8);
  }

  async addMember() {
    const d = this.memberDraft();
    if (!d || this.memberInvalid(d)) return;
    this.busy.set(true);
    try {
      await this.api.addOrgMember({
        email: d.email.trim(),
        name: d.name.trim(),
        role: d.role,
        ...(d.orgUnitId ? { orgUnitId: d.orgUnitId } : {}),
        ...(d.password ? { password: d.password } : {}),
      });
      this.toast.success('Miembro agregado');
      this.memberDraft.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async updateMember(m: OrgMember, data: { role?: Role; orgUnitId?: string }) {
    try {
      const updated = await this.api.updateOrgMember(m.membershipId, data);
      this.members.update((list) => list.map((x) => (x.membershipId === m.membershipId ? { ...x, ...data, ...updated } : x)));
      this.toast.success('Miembro actualizado');
      if (data.orgUnitId) this.units.set(await this.api.adminOrgUnits()); // recalcula memberCount
    } catch (e) {
      this.toast.error(errorMessage(e));
      await this.loadMembers(); // revierte el selector al valor real
    }
  }

  async removeMember(m: OrgMember) {
    if (!confirm(`¿Quitar a ${m.name} (${m.email}) del workspace?`)) return;
    try {
      await this.api.removeOrgMember(m.membershipId);
      this.toast.success('Miembro quitado');
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  /** Un ADMIN no puede cambiar el rol de un OWNER. */
  roleLocked(m: OrgMember) {
    return m.role === 'OWNER' && this.auth.session()?.role !== 'OWNER';
  }

  roleOptions(m: OrgMember): Role[] {
    return this.roleLocked(m) ? ['OWNER'] : this.roles();
  }

  clearAllowed(d: UnitDraft) {
    this.editing.set({ ...d, allowedModels: [] });
  }

  /** Sangría con espacios duros para mostrar la jerarquía dentro de un <option>. */
  pad(depth: number) {
    return '\u00a0\u00a0\u00a0'.repeat(depth);
  }

  isMe(m: OrgMember) {
    return this.auth.me()?.id === m.userId;
  }
}
