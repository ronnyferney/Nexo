import { ChangeDetectionStrategy, Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.service';
import { StudioApi } from '../../core/studio.api';
import type { Routine, RoutineInput } from '../../core/studio.models';
import { ToastService } from '../../core/toast.service';
import { browserTimeZone, CRON_PRESETS, describeCron, isValidCron, timeZones } from '../../shared/cron';
import { IconComponent } from '../../shared/icon.component';

let seq = 0;

/** Formulario de creación/edición de una rutina programada (ADR 0003 D5). */
@Component({
  selector: 'nx-routine-editor',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="card editor stack" (ngSubmit)="save()">
      <div class="row"><nx-icon name="calendar" /><h3>{{ routine() ? 'Editar rutina' : 'Nueva rutina' }}</h3></div>
      <div class="field"><label [for]="uid + '-name'">Nombre</label>
        <input [id]="uid + '-name'" class="input" name="name" required [(ngModel)]="form.name" placeholder="Ej. Resumen diario de ventas" /></div>
      <div class="field"><label [for]="uid + '-prompt'">Instrucción</label>
        <textarea [id]="uid + '-prompt'" class="input" name="prompt" rows="4" required [(ngModel)]="form.prompt"
          placeholder="Qué debe hacer el agente en cada ejecución…"></textarea></div>
      <div class="field">
        <span class="lbl" [id]="uid + '-presets'">Frecuencia</span>
        <div class="row wrap presets" role="group" [attr.aria-labelledby]="uid + '-presets'">
          @for (p of presets; track p.expr) {
            <button type="button" class="btn sm" [class.primary]="form.schedule === p.expr" [attr.aria-pressed]="form.schedule === p.expr"
              (click)="form.schedule = p.expr">{{ p.label }}</button>
          }
        </div>
      </div>
      <div class="grid grid-2">
        <div class="field"><label [for]="uid + '-cron'">Expresión cron</label>
          <input [id]="uid + '-cron'" class="input mono" name="schedule" required [(ngModel)]="form.schedule" placeholder="min hora día mes día-semana"
            [class.invalid]="form.schedule && !validCron()" />
          @if (form.schedule && !validCron()) { <span class="error-text">Use 5 campos: minuto hora día-del-mes mes día-de-la-semana.</span> }
          @else { <span class="hint">{{ describe(form.schedule) }}</span> }</div>
        <div class="field"><label [for]="uid + '-tz'">Zona horaria</label>
          <input [id]="uid + '-tz'" class="input" name="timezone" [(ngModel)]="form.timezone" [attr.list]="uid + '-tzs'" />
          <datalist [id]="uid + '-tzs'">@for (z of zones; track z) { <option [value]="z"></option> }</datalist></div>
      </div>
      <div class="field"><label [for]="uid + '-hook'">Webhook de notificación (opcional)</label>
        <input [id]="uid + '-hook'" class="input" name="hook" type="url" [(ngModel)]="form.notifyWebhookUrl" placeholder="https://…" />
        <span class="hint">Al terminar se envía POST con routineId, runId, status, output y error.</span></div>
      <label class="checkbox"><input type="checkbox" name="enabled" [(ngModel)]="form.enabled" />Habilitada</label>
      <div class="row">
        <span class="spacer"></span>
        <button type="button" class="btn" (click)="cancelled.emit()">Cancelar</button>
        <button type="submit" class="btn primary" [disabled]="saving() || !canSave()"><nx-icon name="save" [size]="15" />{{ saving() ? 'Guardando…' : 'Guardar rutina' }}</button>
      </div>
    </form>
  `,
  styles: `.lbl { font-size: 12.5px; font-weight: 600; color: var(--muted); } .presets { gap: 6px; }`,
})
export class RoutineEditorComponent implements OnInit {
  private readonly studio = inject(StudioApi);
  private readonly toast = inject(ToastService);
  readonly agentId = input.required<string>();
  readonly routine = input<Routine | null>(null);
  readonly saved = output<Routine>();
  readonly cancelled = output<void>();

  readonly uid = `routine-${++seq}`;
  readonly presets = CRON_PRESETS;
  readonly zones = timeZones();
  readonly saving = signal(false);
  form = { name: '', prompt: '', schedule: CRON_PRESETS[1]!.expr, timezone: browserTimeZone(), enabled: true, notifyWebhookUrl: '' };

  ngOnInit() {
    const r = this.routine();
    if (r) {
      this.form = {
        name: r.name,
        prompt: r.prompt,
        schedule: r.schedule,
        timezone: r.timezone || browserTimeZone(),
        enabled: r.enabled,
        notifyWebhookUrl: r.notifyWebhookUrl ?? '',
      };
    }
  }

  describe = describeCron;

  validCron() {
    return isValidCron(this.form.schedule);
  }

  canSave() {
    return this.form.name.trim().length > 0 && this.form.prompt.trim().length > 0 && this.validCron();
  }

  async save() {
    if (!this.canSave() || this.saving()) return;
    this.saving.set(true);
    const r = this.routine();
    const hook = this.form.notifyWebhookUrl.trim();
    const data: RoutineInput = {
      name: this.form.name.trim(),
      prompt: this.form.prompt.trim(),
      schedule: this.form.schedule.trim().split(/\s+/).join(' '),
      timezone: this.form.timezone.trim() || browserTimeZone(),
      enabled: this.form.enabled,
      notifyWebhookUrl: hook || (r ? null : undefined),
    };
    try {
      const result = r ? await this.studio.updateRoutine(r.id, data) : await this.studio.createRoutine(this.agentId(), data);
      this.toast.success(r ? 'Rutina actualizada' : 'Rutina creada');
      this.saved.emit(result);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
