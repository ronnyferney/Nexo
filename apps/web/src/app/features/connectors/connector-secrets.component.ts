import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { Connector } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { TemplateRefPipe } from '../../shared/template-ref.pipe';

/**
 * «Secretos permitidos» de un conector (auditoría A4): la lista de secretos de la bóveda que el conector puede
 * resolver. Cualquier miembro la ve; solo un ADMIN la modifica. Las referencias fuera de la lista fallan al ejecutar.
 */
@Component({
  selector: 'nx-connector-secrets',
  imports: [IconComponent, TemplateRefPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card stack" aria-labelledby="cs-title">
      <div class="row wrap">
        <h2 id="cs-title" class="grow"><nx-icon name="key" [size]="16" /> Secretos permitidos</h2>
        @if (!auth.isAdmin()) { <span class="badge"><nx-icon name="lock" [size]="12" />Solo administradores</span> }
      </div>
      <p class="muted small m0">El conector solo puede usar los secretos de esta lista. Si su configuración, su autenticación
        o sus operaciones referencian otro <code>{{ 'secrets.NOMBRE' | tpl }}</code>, la ejecución falla hasta que un
        administrador lo permita.</p>

      @if (blocked().length) {
        <div class="callout warning" role="alert"><nx-icon name="alert" [size]="16" />
          <span class="grow">Referencias sin permiso: @for (b of blocked(); track b) { <code>{{ b }}</code>{{ $last ? '' : ', ' }} }.
            @if (blocked().includes('secrets')) { No se permite usar la bóveda completa; referencie cada secreto por su nombre. }
            @if (auth.isAdmin()) { Márquelas abajo y guarde para autorizarlas. } @else { Pida a un administrador que las autorice. }</span>
        </div>
      }

      @if (auth.isAdmin()) {
        @if (options().length) {
          <div class="checklist" role="group" aria-labelledby="cs-title">
            @for (o of options(); track o.name) {
              <label class="choice">
                <input type="checkbox" [checked]="selection().has(o.name)" (change)="toggle(o.name, $any($event.target).checked)" />
                <span><code>{{ o.name }}</code>
                  @if (o.referenced) { <span class="badge info">En uso</span> }
                  @if (!o.exists) { <span class="muted small block">No existe en la bóveda</span> }</span>
              </label>
            }
          </div>
        } @else {
          <p class="muted small m0">La bóveda no tiene secretos y el conector no referencia ninguno.</p>
        }
        <div class="row wrap"><span class="spacer"></span>
          @if (missingReferenced().length) {
            <button class="btn sm" [disabled]="busy()" (click)="allowReferenced()">Marcar las referencias en uso</button>
          }
          <button class="btn primary sm" [disabled]="busy() || !dirty()" (click)="save()"><nx-icon name="save" />{{ busy() ? 'Guardando…' : 'Guardar secretos permitidos' }}</button>
        </div>
      } @else {
        @if (allowed().length) {
          <span class="chips">@for (n of allowed(); track n) { <code class="badge">{{ n }}</code> }</span>
        } @else { <p class="muted small m0">Ninguno.</p> }
      }
    </section>
  `,
  styles: `
    .grow { flex: 1; min-width: 0; }
    .m0 { margin: 0; }
    h2 { display: flex; align-items: center; gap: 6px; }
  `,
})
export class ConnectorSecretsComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);

  readonly connector = input.required<Connector>();
  /** Referencias del editor sin guardar (configuración y operación abierta), para avisar antes de guardar. */
  readonly draftRefs = input<string[]>([]);
  readonly saved = output<Connector>();

  readonly vault = signal<string[]>([]);
  readonly selection = signal<Set<string>>(new Set());
  readonly busy = signal(false);

  readonly allowed = computed(() => this.connector().allowedSecrets ?? []);
  readonly referenced = computed(() =>
    [...new Set([...(this.connector().secretReferences ?? []), ...this.draftRefs()])].filter((n) => n !== 'secrets').sort(),
  );
  readonly blocked = computed(() => {
    const ok = new Set(this.allowed());
    const saved = this.connector().blockedSecrets ?? [];
    const draft = this.draftRefs().filter((r) => r === 'secrets' || !ok.has(r));
    return [...new Set([...saved, ...draft])].sort();
  });
  readonly options = computed(() => {
    const vault = new Set(this.vault());
    const referenced = new Set(this.referenced());
    const names = new Set([...vault, ...referenced, ...this.allowed()]);
    return [...names].sort().map((name) => ({ name, exists: vault.has(name), referenced: referenced.has(name) }));
  });
  readonly missingReferenced = computed(() => this.referenced().filter((n) => !this.selection().has(n)));
  readonly dirty = computed(() => {
    const sel = this.selection();
    const cur = this.allowed();
    return sel.size !== cur.length || cur.some((n) => !sel.has(n));
  });

  constructor() {
    effect(() => this.selection.set(new Set(this.allowed())));
    effect(() => {
      if (this.auth.isAdmin()) void this.loadVault();
    });
  }

  private async loadVault() {
    try {
      this.vault.set((await this.api.secrets()).map((s) => s.name));
    } catch {
      this.vault.set([]);
    }
  }

  toggle(name: string, checked: boolean) {
    this.selection.update((s) => {
      const next = new Set(s);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  }

  allowReferenced() {
    this.selection.update((s) => new Set([...s, ...this.referenced()]));
  }

  async save() {
    this.busy.set(true);
    try {
      const updated = await this.api.setConnectorAllowedSecrets(this.connector().id, [...this.selection()].sort());
      this.toast.success('Secretos permitidos actualizados');
      this.saved.emit(updated);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
