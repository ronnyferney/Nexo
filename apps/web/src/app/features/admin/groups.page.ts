import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  Injector,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccessApi } from '../../core/access.api';
import type { UserGroup } from '../../core/access.models';
import { ApiService, errorMessage } from '../../core/api.service';
import type { OrgMember } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

interface GroupDraft {
  id: string | null;
  name: string;
  description: string;
  userIds: Set<string>;
}

/** Cantidad de miembros que se muestran en la tarjeta antes de resumir con «+N». */
const PREVIEW = 6;
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Administración de grupos de usuarios (ADR 0007 D6): audiencias transversales a las unidades a las que se publican
 * agentes (p. ej. «Gerentes de línea» para un agente de resultados financieros). Solo ADMIN/OWNER.
 */
@Component({
  selector: 'nx-admin-groups',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './groups.page.html',
  styles: `
    .groups { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); align-items: start; }
    .g-head { display: flex; gap: 12px; align-items: flex-start; }
    .g-head h2 { margin: 0; font-size: 16px; overflow-wrap: anywhere; }
    .g-head p { margin: 4px 0 0; overflow-wrap: anywhere; }
    .grow { flex: 1; min-width: 0; }
    .person { display: inline-flex; align-items: center; gap: 4px; }
    .group-dlg { width: min(640px, calc(100vw - 24px)); }
    .members-fs { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .members-fs .hint { font-size: 12px; color: var(--muted); }
    .picked { max-height: 120px; overflow: auto; }
    .picked .badge { gap: 2px; padding-right: 2px; }
    .picked .btn { width: 20px; height: 20px; padding: 0; min-height: 0; }
    .people { list-style: none; margin: 0; padding: 4px; max-height: 260px; overflow: auto; border: 1px solid var(--border); border-radius: 10px; }
    .people li label { display: flex; gap: 10px; align-items: center; padding: 7px 8px; border-radius: 8px; cursor: pointer; }
    .people li label:hover { background: var(--surface-2); }
    .people .who { min-width: 0; overflow-wrap: anywhere; }
    @media (max-width: 480px) { .groups { grid-template-columns: 1fr; } }
  `,
})
export class GroupsPage implements OnInit {
  private readonly access = inject(AccessApi);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  readonly preview = PREVIEW;
  readonly groups = signal<UserGroup[]>([]);
  readonly members = signal<OrgMember[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly membersError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly deletingId = signal<string | null>(null);

  readonly draft = signal<GroupDraft | null>(null);
  readonly formError = signal<string | null>(null);
  readonly search = signal('');
  readonly memberById = computed(() => new Map(this.members().map((m) => [m.userId, m])));
  readonly sorted = computed(() => [...this.groups()].sort((a, b) => a.name.localeCompare(b.name, 'es')));
  readonly filteredPeople = computed(() => {
    const q = normalize(this.search().trim());
    const list = [...this.members()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    return q ? list.filter((m) => normalize(`${m.name} ${m.email}`).includes(q)) : list;
  });
  readonly selectedPeople = computed(() => {
    const d = this.draft();
    if (!d) return [];
    const byId = this.memberById();
    const current = this.groups().find((g) => g.id === d.id)?.members ?? [];
    return [...d.userIds].map((id) => byId.get(id) ?? current.find((m) => m.userId === id) ?? { userId: id, name: id, email: '' });
  });

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [groups, members] = await Promise.all([
        this.access.adminGroups(),
        this.api.orgMembers().catch((e) => {
          this.membersError.set(errorMessage(e));
          return [] as OrgMember[];
        }),
      ]);
      this.groups.set(groups);
      this.members.set(members);
      if (members.length) this.membersError.set(null);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  /** Nombres de los miembros que no caben en la vista previa de la tarjeta. */
  restNames(g: UserGroup) {
    return g.members.slice(PREVIEW).map((m) => m.name).join(', ');
  }

  openCreate() {
    this.open({ id: null, name: '', description: '', userIds: new Set() });
  }

  openEdit(g: UserGroup) {
    this.open({ id: g.id, name: g.name, description: g.description ?? '', userIds: new Set(g.members.map((m) => m.userId)) });
  }

  private open(d: GroupDraft) {
    this.formError.set(null);
    this.search.set('');
    this.draft.set(d);
    // Se abre tras renderizar el contenido para que el foco inicial caiga en el campo Nombre.
    afterNextRender(() => this.dialog()?.nativeElement.showModal(), { injector: this.injector });
  }

  close() {
    if (!this.busy()) this.dialog()?.nativeElement.close();
  }

  onCancel(ev: Event) {
    if (this.busy()) ev.preventDefault();
  }

  setName(name: string) {
    this.draft.update((d) => (d ? { ...d, name } : d));
  }

  setDescription(description: string) {
    this.draft.update((d) => (d ? { ...d, description } : d));
  }

  toggle(userId: string, on: boolean) {
    this.draft.update((d) => {
      if (!d) return d;
      const userIds = new Set(d.userIds);
      if (on) userIds.add(userId);
      else userIds.delete(userId);
      return { ...d, userIds };
    });
  }

  validName(d: GroupDraft) {
    return d.name.trim().length >= 2;
  }

  async save() {
    const d = this.draft();
    if (!d || this.busy() || !this.validName(d)) return;
    this.busy.set(true);
    this.formError.set(null);
    const name = d.name.trim();
    const description = d.description.trim();
    const userIds = [...d.userIds];
    try {
      let saved: UserGroup;
      if (!d.id) {
        saved = await this.access.createGroup({ name, ...(description ? { description } : {}), userIds });
        this.groups.update((l) => [...l, saved]);
        this.toast.success(`Grupo «${saved.name}» creado`);
      } else {
        const prev = this.groups().find((g) => g.id === d.id);
        saved = prev!;
        if (!prev || prev.name !== name || (prev.description ?? '') !== description) {
          saved = await this.access.updateGroup(d.id, { name, description });
        }
        const before = new Set(prev?.members.map((m) => m.userId) ?? []);
        if (before.size !== userIds.length || userIds.some((id) => !before.has(id))) {
          saved = await this.access.setGroupMembers(d.id, userIds);
        }
        this.groups.update((l) => l.map((g) => (g.id === saved.id ? saved : g)));
        this.toast.success('Grupo actualizado');
      }
      this.busy.set(false);
      this.dialog()?.nativeElement.close();
    } catch (e) {
      this.formError.set(errorMessage(e));
      this.busy.set(false);
    }
  }

  async remove(g: UserGroup) {
    if (this.deletingId()) return;
    const msg =
      `¿Eliminar el grupo «${g.name}»?\n\n` +
      'Se quitará el acceso a todos los agentes publicados o compartidos con este grupo: sus miembros dejarán de verlos ' +
      'y usarlos, salvo que tengan acceso por otra vía (persona, unidad u otro grupo). Esta acción no se puede deshacer.';
    if (!confirm(msg)) return;
    this.deletingId.set(g.id);
    try {
      await this.access.deleteGroup(g.id);
      this.groups.update((l) => l.filter((x) => x.id !== g.id));
      this.toast.success(`Grupo «${g.name}» eliminado`);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.deletingId.set(null);
    }
  }
}
