import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import type { AgentProfile } from '../../core/studio.models';
import { IconComponent } from '../../shared/icon.component';
import { ListEditorComponent } from '../../shared/list-editor.component';
import { ROLE_TEMPLATES, type RoleTemplate } from './role-templates';

type ListKey = 'goals' | 'responsibilities' | 'boundaries';
type TextKey = 'role' | 'tone' | 'outputFormat' | 'language';

/** Pestaña «Perfil»: rol, objetivos, responsabilidades, límites, tono, formato e idioma (ADR 0003 D2). */
@Component({
  selector: 'nx-agent-profile',
  imports: [IconComponent, ListEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      @if (!disabled()) {
        <div class="card stack">
          <div class="row"><nx-icon name="sparkles" [size]="16" /><strong>Plantillas de rol</strong></div>
          <p class="muted small m0">Precargan el perfil con un punto de partida que luego puede ajustar.</p>
          <div class="templates">
            @for (t of templates; track t.id) {
              <button type="button" class="tpl" (click)="applyTemplate(t)">
                <div class="icon-tile"><nx-icon [name]="t.icon" [size]="16" /></div>
                <div><strong>{{ t.label }}</strong><div class="muted small">{{ t.summary }}</div></div>
              </button>
            }
          </div>
        </div>
      }

      <div class="card stack">
        <div class="field"><label for="pf-role">Rol</label>
          <textarea id="pf-role" class="input" rows="2" [disabled]="disabled()" [value]="profile().role" (input)="setText('role', $any($event.target).value)"
            placeholder="Ej. Eres el asesor comercial de Acme y ayudas a los clientes a elegir el plan adecuado."></textarea>
          <span class="hint">Quién es el agente y para quién trabaja.</span></div>

        <div class="field"><span class="lbl">Objetivos</span>
          <nx-list-editor label="Objetivo" placeholder="Agregar objetivo…" emptyText="Sin objetivos definidos." [disabled]="disabled()"
            [items]="profile().goals" (itemsChange)="setList('goals', $event)" /></div>

        <div class="field"><span class="lbl">Responsabilidades</span>
          <nx-list-editor label="Responsabilidad" placeholder="Agregar responsabilidad…" emptyText="Sin responsabilidades definidas." [disabled]="disabled()"
            [items]="profile().responsibilities" (itemsChange)="setList('responsibilities', $event)" /></div>

        <div class="field"><span class="lbl">Límites (lo que NO debe hacer)</span>
          <nx-list-editor label="Límite" placeholder="Agregar límite…" emptyText="Sin límites definidos." [disabled]="disabled()"
            [items]="profile().boundaries" (itemsChange)="setList('boundaries', $event)" /></div>

        <div class="grid grid-3">
          <div class="field"><label for="pf-tone">Tono</label>
            <input id="pf-tone" class="input" [disabled]="disabled()" [value]="profile().tone" (input)="setText('tone', $any($event.target).value)" placeholder="Cordial y profesional" /></div>
          <div class="field"><label for="pf-format">Formato de salida</label>
            <input id="pf-format" class="input" [disabled]="disabled()" [value]="profile().outputFormat" (input)="setText('outputFormat', $any($event.target).value)" placeholder="Párrafos breves y viñetas" /></div>
          <div class="field"><label for="pf-lang">Idioma</label>
            <input id="pf-lang" class="input" [disabled]="disabled()" [value]="profile().language" (input)="setText('language', $any($event.target).value)" list="pf-langs" placeholder="Español" />
            <datalist id="pf-langs"><option value="Español"></option><option value="Inglés"></option><option value="Portugués"></option><option value="El idioma del usuario"></option></datalist></div>
        </div>
      </div>

      <div class="card stack">
        <div class="field"><label for="pf-system">Instrucciones adicionales</label>
          <textarea id="pf-system" class="input" rows="10" [disabled]="disabled()" [value]="systemPrompt()" (input)="systemPrompt.set($any($event.target).value)"
            placeholder="Reglas de negocio, políticas, cuándo usar cada herramienta…"></textarea>
          <span class="hint">Se agregan al final del perfil en el prompt del sistema. Revise el resultado en «Vista previa».</span></div>
      </div>
    </div>
  `,
  styles: `
    .m0 { margin: 0; }
    .lbl { font-size: 12.5px; font-weight: 600; color: var(--muted); }
    .templates { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
    .tpl { display: flex; gap: 10px; align-items: center; text-align: left; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: inherit; font: inherit; cursor: pointer; }
    .tpl:hover { border-color: var(--primary); }
  `,
})
export class AgentProfileComponent {
  readonly profile = model.required<AgentProfile>();
  readonly systemPrompt = model.required<string>();
  readonly disabled = input(false);
  readonly templates = ROLE_TEMPLATES;

  setText(key: TextKey, value: string) {
    this.profile.update((p) => ({ ...p, [key]: value }));
  }

  setList(key: ListKey, value: string[]) {
    this.profile.update((p) => ({ ...p, [key]: value }));
  }

  applyTemplate(t: RoleTemplate) {
    const p = this.profile();
    const hasContent = p.role || p.goals.length || p.responsibilities.length || p.boundaries.length || p.tone || p.outputFormat;
    if (hasContent && !confirm(`¿Reemplazar el perfil actual con la plantilla «${t.label}»?`)) return;
    this.profile.set(structuredClone(t.profile));
  }
}
