import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.service';
import {
  DataProtectionApi,
  type DataGuardMode,
  type DataPolicy,
  type DataPolicyTest,
} from '../../core/data-protection.api';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

const MODES: { id: DataGuardMode; label: string; help: string }[] = [
  {
    id: 'mask',
    label: 'Enmascarar (recomendado)',
    help: 'Los datos personales se reemplazan por marcadores antes de llegar al modelo y se restituyen en la respuesta.',
  },
  {
    id: 'block',
    label: 'Bloquear',
    help: 'Los mensajes y resultados de herramientas con datos personales no se envían al modelo.',
  },
  {
    id: 'off',
    label: 'Desactivado',
    help: 'Los datos personales se envían tal cual. Las credenciales se ocultan siempre.',
  },
];

/**
 * Protección de datos del workspace (ADR 0008 D2 y D7): política de DataGuard hacia los modelos de IA, retención de
 * conversaciones y una prueba de detección. Solo ADMIN/OWNER (la ruta de administración ya lo exige).
 */
@Component({
  selector: 'nx-data-protection-settings',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card stack" style="max-width:760px">
      <div class="card-title"><div class="icon-tile"><nx-icon name="shield" /></div>
        <div><h2>Protección de datos</h2>
          <p class="muted small">Qué datos personales salen hacia los modelos de IA y cuánto tiempo se conservan las conversaciones</p></div></div>

      @if (loadError()) {
        <div class="callout danger"><nx-icon name="alert" [size]="16" /><span>{{ loadError() }}</span></div>
        <div><button class="btn" (click)="load()">Reintentar</button></div>
      } @else if (policy(); as p) {
        <div class="field">
          <label id="dg-mode">Datos personales hacia los modelos de IA</label>
          <div class="grid grid-3" role="radiogroup" aria-labelledby="dg-mode">
            @for (m of modes; track m.id) {
              <label class="choice">
                <input type="radio" name="dg-mode" [value]="m.id" [checked]="mode() === m.id" [disabled]="saving()"
                  (change)="mode.set(m.id)" />
                <span><strong>{{ m.label }}</strong><span class="muted small" style="display:block">{{ m.help }}</span></span>
              </label>
            }
          </div>
          <span class="hint">Se detectan documentos de identidad (Colombia, España y otros países de Latinoamérica), tarjetas de pago,
            cuentas bancarias e IBAN, correos electrónicos y teléfonos.</span>
        </div>

        <div class="callout info">
          <nx-icon name="lock" [size]="16" />
          <span>Las credenciales (valores de la bóveda de secretos, llaves de API, tokens y contraseñas) nunca se envían al modelo,
            cualquiera sea la política elegida.</span>
        </div>

        <div class="field">
          <label for="dg-retention">Retención de conversaciones</label>
          <div class="row" style="gap:14px; align-items:center; flex-wrap:wrap">
            <label class="row" style="gap:8px; align-items:center">
              <input type="checkbox" [checked]="unlimited()" [disabled]="saving()" (change)="unlimited.set($any($event.target).checked)" />
              <span>Sin límite</span>
            </label>
            @if (!unlimited()) {
              <div class="row" style="gap:8px; align-items:center">
                <input id="dg-retention" class="input" type="number" min="1" max="3650" step="1" style="width:120px"
                  [class.invalid]="!retentionValid()" [disabled]="saving()"
                  [ngModel]="days()" (ngModelChange)="days.set($event)" aria-describedby="dg-retention-hint" />
                <span>días</span>
              </div>
            }
          </div>
          <span id="dg-retention-hint" class="hint">
            Las conversaciones con agentes y con el Copilot sin actividad durante ese plazo se eliminan cada día, junto con sus
            mensajes y calificaciones.
            @if (p.platformDefaultRetentionDays) { Valor por defecto de la plataforma: {{ p.platformDefaultRetentionDays }} días. }
          </span>
          @if (!retentionValid()) { <span class="hint" style="color:var(--danger)">Indique un número entero de días entre 1 y 3650.</span> }
        </div>

        <div class="row" style="justify-content:flex-end; gap:8px">
          <button class="btn primary" [disabled]="!dirty() || !retentionValid() || saving()" (click)="save()">
            <nx-icon name="save" [size]="15" /> {{ saving() ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>

        <hr style="border:none; border-top:1px solid var(--border); margin:4px 0" />

        <div class="field">
          <label for="dg-test">Probar la detección</label>
          <textarea id="dg-test" class="input" rows="3" maxlength="20000" [ngModel]="sample()" (ngModelChange)="sample.set($event)"
            placeholder="Escriba un texto de ejemplo, p. ej.: Mi cédula es 1.020.304.050 y mi correo ana@empresa.com"></textarea>
          <span class="hint">Se analiza con la política guardada; el texto no se envía a ningún modelo ni se almacena.</span>
        </div>
        <div><button class="btn" [disabled]="!sample().trim() || testing()" (click)="runTest()">
          <nx-icon name="eye" [size]="15" /> {{ testing() ? 'Analizando…' : 'Ver lo que recibiría el modelo' }}</button></div>
        @if (result(); as r) {
          <div class="stack" style="gap:8px">
            @if (!r.findings.length) {
              <p class="muted small" style="margin:0">No se detectaron datos personales ni credenciales.</p>
            } @else {
              <div class="chips">
                @for (c of foundCategories(); track c.id) { <span class="badge warning">{{ c.label }} · {{ c.count }}</span> }
              </div>
            }
            @if (r.blocked) {
              <div class="callout warning"><nx-icon name="alert" [size]="16" />
                <span>Con la política «Bloquear» este mensaje no se enviaría al modelo.</span></div>
            } @else {
              <pre class="textarea-mono" style="white-space:pre-wrap; margin:0; padding:10px 12px; border:1px solid var(--border); border-radius:9px">{{ r.masked }}</pre>
            }
          </div>
        }
      } @else {
        <p class="muted small">Cargando…</p>
      }
    </div>
  `,
})
export class DataProtectionSettingsComponent implements OnInit {
  private readonly api = inject(DataProtectionApi);
  private readonly toast = inject(ToastService);
  readonly modes = MODES;

  readonly policy = signal<DataPolicy | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly mode = signal<DataGuardMode>('mask');
  readonly unlimited = signal(true);
  readonly days = signal<number | string>(90);
  readonly saving = signal(false);
  readonly sample = signal('');
  readonly testing = signal(false);
  readonly result = signal<DataPolicyTest | null>(null);

  readonly retentionValid = computed(() => {
    if (this.unlimited()) return true;
    const n = Number(this.days());
    return Number.isInteger(n) && n >= 1 && n <= 3650;
  });
  private readonly retention = computed(() => (this.unlimited() ? null : Number(this.days())));
  readonly dirty = computed(() => {
    const p = this.policy();
    return !!p && (p.dataGuardMode !== this.mode() || p.conversationRetentionDays !== this.retention());
  });
  readonly foundCategories = computed(() => {
    const r = this.result();
    const p = this.policy();
    if (!r || !p) return [];
    const counts = new Map<string, number>();
    for (const f of r.findings) counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
    return [...counts].map(([id, count]) => ({ id, count, label: p.categories.find((c) => c.id === id)?.label ?? id }));
  });

  ngOnInit() {
    void this.load();
  }

  private apply(p: DataPolicy) {
    this.policy.set(p);
    this.mode.set(p.dataGuardMode);
    this.unlimited.set(p.conversationRetentionDays === null);
    if (p.conversationRetentionDays !== null) this.days.set(p.conversationRetentionDays);
  }

  async load() {
    this.loadError.set(null);
    try {
      this.apply(await this.api.policy());
    } catch (e) {
      this.loadError.set(errorMessage(e));
    }
  }

  async save() {
    if (!this.retentionValid()) return;
    this.saving.set(true);
    try {
      this.apply(await this.api.updatePolicy({ dataGuardMode: this.mode(), conversationRetentionDays: this.retention() }));
      this.result.set(null);
      this.toast.success('Política de protección de datos guardada');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  async runTest() {
    this.testing.set(true);
    try {
      this.result.set(await this.api.test(this.sample()));
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.testing.set(false);
    }
  }
}
