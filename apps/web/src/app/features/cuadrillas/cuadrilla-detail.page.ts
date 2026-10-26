import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  Injector,
  input,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CrewsApi } from '../../core/crews.api';
import {
  CREW_ESTADO_BADGE,
  CREW_ESTADO_LABELS,
  type CreateCrewVersionInput,
  type CrewDetail,
  type CrewMemberInput,
  type CrewVersion,
  type InstantiateResult,
} from '../../core/crews.models';
import { type Cargo, NIVEL_LABELS, NIVELES_JERARQUICOS } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { ErrorStateComponent } from '../../shared/error-state.component';
import { IconComponent } from '../../shared/icon.component';
import { JsonEditorComponent } from '../../shared/json-editor.component';
import { ListEditorComponent } from '../../shared/list-editor.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { PageHeaderComponent } from '../../layout/page-header.component';
import { crewActions, totalesPermisosPendientes, resumirPermisosPendientes } from './crews.logic';

/** Borrador de un miembro en el editor de versión (listas y JSON editables en vivo). */
interface MemberDraft {
  rol: string;
  cargoId: string;
  nivelEsperado: string;
  skills: string[];
  conectoresSugeridos: string[];
  delegaA: string[];
  politicaSugerida: Record<string, unknown>;
  criteriosResultado: Record<string, unknown>;
}

const emptyMember = (): MemberDraft => ({
  rol: '',
  cargoId: '',
  nivelEsperado: '',
  skills: [],
  conectoresSugeridos: [],
  delegaA: [],
  politicaSugerida: {},
  criteriosResultado: {},
});

/**
 * Detalle de una Cuadrilla (ADR 0014 · D1 · E11): identidad, estado, versiones append-only y, por versión, sus
 * miembros declarativos. Acciones de gobierno por rol: publicar/retirar/nueva versión (ADMIN) e instanciar (EDITOR+,
 * solo si está PUBLICADA). El editor de versión es SOLO declarativo: no ofrece ningún campo de código, hook, comando ni
 * URL de arranque. Instanciar no concede acceso: el diálogo de resultado muestra los permisos pendientes de conceder.
 */
@Component({
  selector: 'nx-cuadrilla-detail',
  imports: [
    FormsModule,
    RouterLink,
    IconComponent,
    JsonEditorComponent,
    ListEditorComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    LoadingStateComponent,
    RelativeTimePipe,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cuadrilla-detail.page.html',
  styles: `
    .lead-back { margin-right: 4px; }
    .meta-row { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin-top: 8px; }
    .meta-row .muted { display: inline-flex; align-items: center; gap: 4px; }
    .declarative-note { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 20px; }
    .versions { display: flex; flex-direction: column; gap: 16px; }
    .version-card { display: flex; flex-direction: column; gap: 14px; }
    .v-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .v-head h2 { margin: 0; font-size: 16px; }
    .v-head .grow { flex: 1; min-width: 0; }
    .members { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); align-items: start; }
    .member { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
    .member h3 { margin: 0; font-size: 14px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .facet { font-size: 12px; }
    .facet .lbl { color: var(--muted); font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
    .facet pre { margin: 4px 0 0; padding: 8px; background: var(--surface-2); border-radius: 8px; overflow-x: auto; font-size: 11.5px; }
    .m0 { margin: 0; }
    .instances { display: flex; flex-direction: column; gap: 8px; }
    .instance { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 10px 12px; border: 1px solid var(--border); border-radius: 9px; flex-wrap: wrap; }

    .modal.wide { max-width: 860px; width: 94vw; }
    .modal-body { display: flex; flex-direction: column; gap: 14px; }
    .grid-2 { display: grid; gap: 14px; grid-template-columns: 1fr 1fr; }
    .member-edit { border: 1px solid var(--border); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
    .member-edit > .m-head { display: flex; gap: 8px; align-items: center; }
    .member-edit > .m-head .grow { flex: 1; }
    .sub { font-size: 12px; color: var(--muted); font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }

    .pending-list { display: flex; flex-direction: column; gap: 10px; }
    .pending { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
    .pending .p-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .totals { display: flex; flex-wrap: wrap; gap: 8px; }
    @media (max-width: 640px) { .grid-2 { grid-template-columns: 1fr; } }
  `,
})
export class CuadrillaDetailPage implements OnInit {
  private readonly crews = inject(CrewsApi);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  private readonly versionDialog = viewChild<ElementRef<HTMLDialogElement>>('versionDlg');
  private readonly instDialog = viewChild<ElementRef<HTMLDialogElement>>('instDlg');
  private readonly resultDialog = viewChild<ElementRef<HTMLDialogElement>>('resultDlg');

  /** Id de la plantilla, enlazado desde la ruta (`withComponentInputBinding`). */
  readonly id = input.required<string>();

  readonly niveles = NIVELES_JERARQUICOS;
  readonly nivelLabels = NIVEL_LABELS;
  readonly estadoLabels = CREW_ESTADO_LABELS;
  readonly estadoBadge = CREW_ESTADO_BADGE;

  readonly crew = signal<CrewDetail | null>(null);
  readonly cargos = signal<Cargo[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly acting = signal(false);

  private readonly cargoNames = computed(() => new Map(this.cargos().map((c) => [c.id, c.nombre])));

  /** Acciones de gobierno visibles según estado + rol + si la última versión tiene miembros. */
  readonly actions = computed(() => {
    const c = this.crew();
    if (!c) return { addVersion: false, publish: false, retire: false, instantiate: false };
    const last = c.versiones[c.versiones.length - 1];
    const hasMembers = !!last && last.miembros.length > 0;
    return crewActions(c.estado, { isAdmin: this.auth.isAdmin(), canEdit: this.auth.canEdit() }, hasMembers);
  });

  // --- Editor de versión ---
  readonly draftMembers = signal<MemberDraft[] | null>(null);
  readonly versionBusy = signal(false);
  readonly versionError = signal<string | null>(null);

  // --- Instanciar ---
  readonly instVersionId = signal<string>('');
  readonly instBusy = signal(false);
  readonly instError = signal<string | null>(null);

  // --- Resultado de instanciar ---
  readonly result = signal<InstantiateResult | null>(null);
  readonly resumen = computed(() => (this.result() ? resumirPermisosPendientes(this.result()!.permisosPendientes) : []));
  readonly totales = computed(() =>
    this.result() ? totalesPermisosPendientes(this.result()!.permisosPendientes) : null,
  );

  ngOnInit() {
    void this.load();
  }

  cargoName(id: string | null): string {
    return id ? (this.cargoNames().get(id) ?? id) : '';
  }

  /** Etiqueta en español de un nivel jerárquico; si no se reconoce, devuelve el texto tal cual. */
  nivelLabel(nivel: string | null): string {
    if (!nivel) return '';
    return (NIVEL_LABELS as Record<string, string>)[nivel] ?? nivel;
  }

  /** `true` si un objeto declarativo trae alguna clave (para no renderizar bloques vacíos). */
  hasKeys(value: Record<string, unknown> | null | undefined): boolean {
    return !!value && Object.keys(value).length > 0;
  }

  /** JSON legible para mostrar política/criterios declarativos. */
  pretty(value: unknown): string {
    return JSON.stringify(value ?? {}, null, 2);
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [crew, cargos] = await Promise.all([this.crews.get_(this.id()), this.api.cargos().catch(() => [])]);
      this.crew.set(crew);
      this.cargos.set(cargos);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  // ------------------------------------------------- Ciclo de vida ----------------------------------------------------

  async publish() {
    const c = this.crew();
    if (!c || this.acting()) return;
    if (!confirm(`¿Publicar la Cuadrilla «${c.nombre}»? Quedará disponible para instanciar y su última versión se sella (inmutable).`))
      return;
    this.acting.set(true);
    try {
      this.crew.set(await this.crews.publish(c.id));
      this.toast.success('Cuadrilla publicada');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.acting.set(false);
    }
  }

  async retire() {
    const c = this.crew();
    if (!c || this.acting()) return;
    if (!confirm(`¿Retirar la Cuadrilla «${c.nombre}»? Dejará de ofrecerse para instanciar; las instancias existentes no se ven afectadas.`))
      return;
    this.acting.set(true);
    try {
      this.crew.set(await this.crews.retire(c.id));
      this.toast.success('Cuadrilla retirada');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.acting.set(false);
    }
  }

  // ------------------------------------------------- Editor de versión ------------------------------------------------

  openVersionEditor() {
    if (!this.actions().addVersion) return;
    this.versionError.set(null);
    // Parte de los miembros de la última versión como punto de partida (append-only: crea una versión nueva).
    const last = this.crew()?.versiones.at(-1);
    this.draftMembers.set(last && last.miembros.length ? last.miembros.map(toDraft) : [emptyMember()]);
    afterNextRender(() => this.versionDialog()?.nativeElement.showModal(), { injector: this.injector });
  }

  addMember() {
    this.draftMembers.update((m) => (m ? [...m, emptyMember()] : m));
  }

  removeMember(i: number) {
    this.draftMembers.update((m) => (m && m.length > 1 ? m.filter((_, j) => j !== i) : m));
  }

  patchMember(i: number, part: Partial<MemberDraft>) {
    this.draftMembers.update((m) => (m ? m.map((x, j) => (j === i ? { ...x, ...part } : x)) : m));
  }

  closeVersion() {
    if (!this.versionBusy()) this.versionDialog()?.nativeElement.close();
  }

  onVersionCancel(ev: Event) {
    if (this.versionBusy()) ev.preventDefault();
  }

  readonly versionValid = computed(() => {
    const m = this.draftMembers();
    return !!m && m.length > 0 && m.every((x) => x.rol.trim().length > 0);
  });

  async saveVersion() {
    const members = this.draftMembers();
    const c = this.crew();
    if (!members || !c || this.versionBusy() || !this.versionValid()) return;
    this.versionBusy.set(true);
    this.versionError.set(null);
    const payload: CreateCrewVersionInput = { miembros: members.map(toInput) };
    try {
      await this.crews.addVersion(c.id, payload);
      this.crew.set(await this.crews.get_(c.id));
      this.versionBusy.set(false);
      this.versionDialog()?.nativeElement.close();
      this.toast.success('Versión agregada');
    } catch (e) {
      // El backend rechaza con 400 si algo no es declarativo (código/hook/URL de arranque): mostramos el motivo.
      this.versionError.set(errorMessage(e));
      this.versionBusy.set(false);
    }
  }

  // ------------------------------------------------- Instanciar -------------------------------------------------------

  openInstantiate() {
    if (!this.actions().instantiate) return;
    this.instError.set(null);
    this.instVersionId.set(this.crew()?.versiones.at(-1)?.id ?? '');
    afterNextRender(() => this.instDialog()?.nativeElement.showModal(), { injector: this.injector });
  }

  closeInstantiate() {
    if (!this.instBusy()) this.instDialog()?.nativeElement.close();
  }

  onInstCancel(ev: Event) {
    if (this.instBusy()) ev.preventDefault();
  }

  async confirmInstantiate() {
    const c = this.crew();
    if (!c || this.instBusy()) return;
    this.instBusy.set(true);
    this.instError.set(null);
    try {
      const res = await this.crews.instantiate(c.id, { versionId: this.instVersionId() || undefined });
      this.instBusy.set(false);
      this.instDialog()?.nativeElement.close();
      this.result.set(res);
      this.crew.set(await this.crews.get_(c.id));
      afterNextRender(() => this.resultDialog()?.nativeElement.showModal(), { injector: this.injector });
    } catch (e) {
      this.instError.set(errorMessage(e));
      this.instBusy.set(false);
    }
  }

  closeResult() {
    this.resultDialog()?.nativeElement.close();
  }

  goToAgent(agentId: string) {
    this.closeResult();
    void this.router.navigate(['/agents', agentId]);
  }
}

/** Miembro persistido → borrador editable (JSON como objeto, referencias de conector como texto). */
function toDraft(m: CrewVersion['miembros'][number]): MemberDraft {
  return {
    rol: m.rol,
    cargoId: m.cargoId ?? '',
    nivelEsperado: m.nivelEsperado ?? '',
    skills: [...m.skills],
    conectoresSugeridos: (m.conectoresSugeridos ?? []).map((r) =>
      typeof r === 'string' ? r : JSON.stringify(r),
    ),
    delegaA: [...m.delegaA],
    politicaSugerida: m.politicaSugerida ?? {},
    criteriosResultado: m.criteriosResultado ?? {},
  };
}

/** Borrador → DTO del backend. Las referencias de conector van como texto declarativo (nunca URL de arranque). */
function toInput(d: MemberDraft): CrewMemberInput {
  return {
    rol: d.rol.trim(),
    cargoId: d.cargoId || undefined,
    nivelEsperado: d.nivelEsperado || undefined,
    skills: d.skills,
    conectoresSugeridos: d.conectoresSugeridos,
    politicaSugerida: d.politicaSugerida,
    criteriosResultado: d.criteriosResultado,
    delegaA: d.delegaA,
  };
}
