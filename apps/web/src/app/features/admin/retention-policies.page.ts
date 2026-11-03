import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type {
  ResolvedRetention,
  RetentionChannel,
  RetentionInfoType,
  RetentionPolicy,
  RetentionPolicyInput,
} from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

const CHANNEL_LABELS: Record<RetentionChannel, string> = {
  CORREO: 'Correo',
  WHATSAPP: 'WhatsApp',
  VOZ: 'Voz',
  CHAT: 'Chat',
};
const INFO_LABELS: Record<RetentionInfoType, string> = {
  ORDINARIA: 'Ordinaria',
  EVIDENCIA: 'Evidencia',
  SENSIBLE: 'Sensible',
};

interface PolicyDraft {
  exists: boolean;
  canal: RetentionChannel | '';
  tipoInformacion: RetentionInfoType | '';
  retencionDias: number | null;
  eliminacionSegura: boolean;
  consentimientoRequerido: boolean;
}

/**
 * Políticas de retención/privacidad diferenciadas por alcance (canal + tipo de información) (P0.2 · decisión
 * Jurídica). CRUD gobernado (solo ADMIN) más un resolutor de prueba que muestra la política vigente de un alcance.
 * No declara cumplimiento normativo ni valor probatorio: son controles técnicos.
 */
@Component({
  selector: 'nx-retention-policies',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div><h1>Retención de datos</h1><p>Plazos de conservación diferenciados por canal y tipo de información</p></div>
        <button class="btn" (click)="load()" [disabled]="loading()"><nx-icon name="refresh" [size]="15" />Actualizar</button>
      </div>

      <div class="callout info" style="margin-bottom:16px"><nx-icon name="info" [size]="16" /><span>Gana la política
        <strong>más específica</strong> aplicable al alcance. Si una política no fija plazo propio, o no hay ninguna
        aplicable, rige la retención del workspace. Son controles técnicos: no declaran cumplimiento normativo ni valor
        probatorio.</span></div>

      @if (canEdit() && draft(); as d) {
        <div class="card stack" style="margin-bottom:16px">
          <div class="card-title"><div class="icon-tile"><nx-icon name="lock" /></div>
            <div><h2>{{ d.exists ? 'Editar' : 'Nueva' }} política</h2>
              <p class="muted small" style="margin:0">El alcance es la combinación de canal y tipo (vacío = todos)</p></div>
            <span class="spacer"></span>
            <button class="btn ghost icon" title="Cerrar" aria-label="Cerrar" (click)="draft.set(null)"><nx-icon name="x" /></button></div>

          <div class="grid grid-2">
            <div class="field"><label for="r-canal">Canal</label>
              <select id="r-canal" class="input" [(ngModel)]="d.canal" [disabled]="d.exists">
                <option value="">Todos los canales</option>
                @for (c of channels; track c) { <option [value]="c">{{ channelLabels[c] }}</option> }
              </select></div>
            <div class="field"><label for="r-tipo">Tipo de información</label>
              <select id="r-tipo" class="input" [(ngModel)]="d.tipoInformacion" [disabled]="d.exists">
                <option value="">Todos los tipos</option>
                @for (t of infoTypes; track t) { <option [value]="t">{{ infoLabels[t] }}</option> }
              </select></div>
          </div>

          <div class="field" style="max-width:280px"><label for="r-dias">Retención (días)</label>
            <input id="r-dias" class="input" type="number" min="1" max="3650" [(ngModel)]="d.retencionDias" placeholder="Hereda del workspace" />
            <span class="hint">Vacío = hereda la retención del workspace. Máx. 3650.</span></div>

          <label class="choice" style="max-width:none"><input type="checkbox" name="r-elim" [(ngModel)]="d.eliminacionSegura" />
            <span><strong>Eliminación segura al vencer</strong></span></label>
          <label class="choice" style="max-width:none"><input type="checkbox" name="r-cons" [(ngModel)]="d.consentimientoRequerido" />
            <span><strong>Requiere consentimiento</strong></span></label>

          <div class="row"><span class="spacer"></span>
            <button class="btn" (click)="draft.set(null)">Cancelar</button>
            <button class="btn primary" [disabled]="saving() || invalid(d)" (click)="save()"><nx-icon name="save" />{{ saving() ? 'Guardando…' : 'Guardar' }}</button></div>
        </div>
      }

      @if (loading()) {
        <div class="card empty"><p>Cargando políticas…</p></div>
      } @else if (error()) {
        <div class="card empty" role="alert"><nx-icon name="alert" [size]="28" /><h3>No se pudieron cargar las políticas</h3>
          <p>{{ error() }}</p><button class="btn" (click)="load()">Reintentar</button></div>
      } @else {
        <div class="row" style="margin-bottom:10px">
          <span class="spacer"></span>
          @if (canEdit() && !draft()) { <button class="btn primary" (click)="open()"><nx-icon name="plus" [size]="15" />Nueva política</button> }
        </div>
        <div class="card" style="padding:0">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Canal</th><th>Tipo</th><th>Retención</th><th>Eliminación</th><th>Consentimiento</th><th></th></tr></thead>
              <tbody>
                @for (p of policies(); track p.id) {
                  <tr>
                    <td>{{ p.canal ? channelLabels[p.canal] : 'Todos' }}</td>
                    <td>{{ p.tipoInformacion ? infoLabels[p.tipoInformacion] : 'Todos' }}</td>
                    <td>{{ p.retencionDias !== null ? p.retencionDias + ' días' : 'Hereda del workspace' }}</td>
                    <td>@if (p.eliminacionSegura) { <span class="badge info">Sí</span> } @else { <span class="muted">No</span> }</td>
                    <td>@if (p.consentimientoRequerido) { <span class="badge warning">Sí</span> } @else { <span class="muted">No</span> }</td>
                    <td class="num nowrap">
                      @if (canEdit()) {
                        <button class="btn sm" (click)="edit(p)"><nx-icon name="pencil" [size]="14" />Editar</button>
                        <button class="btn ghost icon sm danger" title="Eliminar" aria-label="Eliminar política" (click)="remove(p)"><nx-icon name="trash" [size]="14" /></button>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="6"><div class="empty"><p>No hay políticas diferenciadas. Rige la retención del workspace.</p></div></td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>

        <div class="card stack" style="margin-top:16px">
          <div class="card-title"><div class="icon-tile"><nx-icon name="beaker" /></div>
            <div><h2>Probar resolución</h2><p class="muted small" style="margin:0">Consulte la política vigente de un alcance</p></div></div>
          <div class="grid grid-2">
            <div class="field"><label for="rr-canal">Canal</label>
              <select id="rr-canal" class="input" [(ngModel)]="probeCanal">
                <option value="">Sin especificar</option>
                @for (c of channels; track c) { <option [value]="c">{{ channelLabels[c] }}</option> }
              </select></div>
            <div class="field"><label for="rr-tipo">Tipo de información</label>
              <select id="rr-tipo" class="input" [(ngModel)]="probeTipo">
                <option value="">Sin especificar</option>
                @for (t of infoTypes; track t) { <option [value]="t">{{ infoLabels[t] }}</option> }
              </select></div>
          </div>
          <div class="row"><button class="btn" [disabled]="resolving()" (click)="resolve()"><nx-icon name="play" [size]="15" />Resolver</button></div>
          @if (resolved(); as r) {
            <div class="callout info"><nx-icon name="shield" [size]="16" /><span>
              Plazo: <strong>{{ r.retencionDias !== null ? r.retencionDias + ' días' : 'sin límite' }}</strong>
              (origen: {{ r.origen === 'POLITICA' ? 'política diferenciada' : 'retención del workspace' }}) ·
              Eliminación segura: {{ r.eliminacionSegura ? 'sí' : 'no' }} ·
              Consentimiento: {{ r.consentimientoRequerido ? 'sí' : 'no' }}.
              @if (r.politicaAplicada; as pa) {
                Alcance aplicado: {{ pa.canal ? channelLabels[pa.canal] : 'todos los canales' }} /
                {{ pa.tipoInformacion ? infoLabels[pa.tipoInformacion] : 'todos los tipos' }}.
              }
            </span></div>
          }
        </div>
      }
    </div>
  `,
})
export class RetentionPoliciesPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly canEdit = this.auth.isAdmin;
  readonly channels: RetentionChannel[] = ['CORREO', 'WHATSAPP', 'VOZ', 'CHAT'];
  readonly infoTypes: RetentionInfoType[] = ['ORDINARIA', 'EVIDENCIA', 'SENSIBLE'];
  readonly channelLabels = CHANNEL_LABELS;
  readonly infoLabels = INFO_LABELS;

  readonly policies = signal<RetentionPolicy[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly draft = signal<PolicyDraft | null>(null);

  readonly resolved = signal<ResolvedRetention | null>(null);
  readonly resolving = signal(false);
  probeCanal: RetentionChannel | '' = '';
  probeTipo: RetentionInfoType | '' = '';

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.policies.set(await this.api.retentionPolicies());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  open() {
    this.draft.set({
      exists: false,
      canal: '',
      tipoInformacion: '',
      retencionDias: null,
      eliminacionSegura: false,
      consentimientoRequerido: false,
    });
  }

  edit(p: RetentionPolicy) {
    this.draft.set({
      exists: true,
      canal: p.canal ?? '',
      tipoInformacion: p.tipoInformacion ?? '',
      retencionDias: p.retencionDias,
      eliminacionSegura: p.eliminacionSegura,
      consentimientoRequerido: p.consentimientoRequerido,
    });
  }

  invalid(d: PolicyDraft) {
    return d.retencionDias != null && (d.retencionDias < 1 || d.retencionDias > 3650);
  }

  async save() {
    const d = this.draft();
    if (!d || this.invalid(d)) return;
    const body: RetentionPolicyInput = {
      canal: d.canal || null,
      tipoInformacion: d.tipoInformacion || null,
      retencionDias: d.retencionDias != null ? Number(d.retencionDias) : null,
      eliminacionSegura: d.eliminacionSegura,
      consentimientoRequerido: d.consentimientoRequerido,
    };
    this.saving.set(true);
    try {
      await this.api.upsertRetentionPolicy(body);
      this.toast.success('Política guardada');
      this.draft.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  async remove(p: RetentionPolicy) {
    if (!confirm('¿Eliminar esta política? Su alcance volverá a resolverse por la retención del workspace.')) return;
    try {
      await this.api.deleteRetentionPolicy(p.id);
      this.toast.success('Política eliminada');
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async resolve() {
    this.resolving.set(true);
    try {
      this.resolved.set(
        await this.api.resolveRetention({
          ...(this.probeCanal ? { canal: this.probeCanal } : {}),
          ...(this.probeTipo ? { tipoInformacion: this.probeTipo } : {}),
        }),
      );
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.resolving.set(false);
    }
  }
}
