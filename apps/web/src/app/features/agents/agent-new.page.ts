import { ChangeDetectionStrategy, Component, ElementRef, inject, input, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import type { CopilotApplyNavigationState, CopilotApplyResult, CopilotProposal } from '../../core/copilot.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { CopilotPanelComponent } from '../copilot/copilot-panel.component';
import { BLANK_TEMPLATE, INDUSTRY_TEMPLATES, type IndustryTemplate } from './industry-templates';
import { ROLE_TEMPLATES } from './role-templates';

const DEFAULT_PROMPT =
  'Eres un asistente profesional. Usa las herramientas disponibles cuando sea necesario y responde en español de forma clara y concisa.';

/**
 * Alta de agentes (ADR 0006 D5): camino recomendado con la entrevista de Nexo Copilot (modo CREATE, con plantillas por
 * industria) o camino experto con el formulario mínimo. Todo agente nuevo nace Personal (ADR 0007).
 * Parámetros: `?plantilla=logistics|sales|support|blank` abre la entrevista; `?modo=experto` enfoca el formulario.
 */
@Component({
  selector: 'nx-agent-new',
  imports: [FormsModule, RouterLink, IconComponent, CopilotPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div class="row head">
          @if (template()) {
            <button type="button" class="btn ghost icon" title="Volver a las opciones" aria-label="Volver a las opciones" (click)="template.set(null)"><nx-icon name="arrowLeft" /></button>
          } @else {
            <a class="btn ghost icon" routerLink="/agents" title="Volver a agentes" aria-label="Volver a agentes"><nx-icon name="arrowLeft" /></a>
          }
          <div><h1>Nuevo agente</h1>
            <p>{{ template() ? 'Entrevista con Nexo Copilot · ' + template()!.label : 'Elija cómo quiere empezar. El agente se crea como Personal: solo usted lo ve hasta que lo comparta.' }}</p></div>
        </div>
      </div>

      @if (template(); as t) {
        <div class="interview">
          <aside class="card side">
            <div class="row"><div class="icon-tile"><nx-icon [name]="t.icon" /></div><strong>{{ t.label }}</strong></div>
            <p class="muted small">{{ t.summary }}</p>
            <ol class="small steps">
              <li>Cuéntele al Copilot qué debe resolver el agente.</li>
              <li>Responda sus preguntas: sistemas, límites y casos.</li>
              <li>Revise la propuesta y pulse <strong>Aplicar</strong> para crearlo.</li>
            </ol>
            <p class="muted small">El Copilot no crea nada sin su aprobación. El agente nace en <strong>borrador</strong> y <strong>Personal</strong>.</p>
            <button type="button" class="btn sm" (click)="goExpert()">Prefiero crearlo vacío</button>
          </aside>
          <nx-copilot-panel variant="page" [modes]="['CREATE']" mode="CREATE" [context]="t.context" [starters]="t.starters" (applied)="onApplied($event)" />
        </div>
      } @else {
        <div class="paths">
          <section class="card path rec" aria-labelledby="path-copilot">
            <div class="row wrap"><span class="mark" aria-hidden="true">N</span>
              <h2 id="path-copilot">Crear con Nexo Copilot</h2><span class="badge primary">Recomendado</span></div>
            <p class="muted">Una entrevista breve en la que el Copilot diseña el agente completo: perfil, modelo, herramientas,
              conocimiento y al menos 5 casos de evaluación. Usted revisa todo antes de crearlo.</p>
            <div class="tpls" role="list">
              @for (t of templates; track t.id) {
                <button type="button" class="tpl" role="listitem" (click)="start(t)">
                  <span class="row tpl-head"><nx-icon [name]="t.icon" [size]="18" /><strong>{{ t.label }}</strong></span>
                  <span class="small muted">{{ t.summary }}</span>
                </button>
              }
            </div>
          </section>

          <section class="card path" aria-labelledby="path-expert">
            <div class="row"><div class="icon-tile"><nx-icon name="pencil" /></div><h2 id="path-expert">Soy experto: crear vacío</h2></div>
            <p class="muted">Cree el agente con un nombre y configúrelo usted mismo en el estudio.</p>
            <form class="stack" (ngSubmit)="createEmpty()">
              <div class="field"><label for="new-name">Nombre del agente</label>
                <input #nameInput id="new-name" class="input" name="name" [(ngModel)]="name" required minlength="2" placeholder="Ej.: Asistente de despachos" /></div>
              <div class="field"><label for="new-role">Plantilla de rol (opcional)</label>
                <select id="new-role" class="input" name="role" [(ngModel)]="roleId">
                  <option value="">Sin plantilla</option>
                  @for (r of roles; track r.id) { <option [value]="r.id">{{ r.label }} — {{ r.summary }}</option> }
                </select>
                <span class="hint">Precarga rol, objetivos y límites; no consume el cupo del Copilot.</span></div>
              <div class="row"><span class="spacer"></span>
                <button type="submit" class="btn primary" [disabled]="creating() || name.trim().length < 2"><nx-icon name="plus" />{{ creating() ? 'Creando…' : 'Crear agente' }}</button></div>
            </form>
          </section>
        </div>
      }
    </div>
  `,
  styles: `
    .head { min-width: 0; }
    .paths { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 16px; align-items: start; }
    .path h2 { font-size: 16px; }
    .path p { margin: 10px 0 14px; }
    .rec { border-color: color-mix(in srgb, var(--brand-violet) 55%, var(--border)); background: linear-gradient(160deg, color-mix(in srgb, var(--brand-blue) 8%, var(--surface)), var(--surface) 55%); }
    .mark { width: 34px; height: 34px; border-radius: 10px; background: linear-gradient(135deg, var(--brand-blue), var(--brand-violet)); color: #fff; font-weight: 800; display: grid; place-items: center; }
    .tpls { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
    .tpl { display: flex; flex-direction: column; gap: 4px; text-align: left; padding: 12px 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: inherit; font: inherit; cursor: pointer; }
    .tpl:hover { border-color: var(--brand-violet); background: color-mix(in srgb, var(--brand-violet) 7%, var(--surface)); }
    .tpl-head { gap: 8px; color: var(--brand-violet-text); }
    .tpl-head strong { color: var(--text); }
    .interview { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 16px; height: calc(100dvh - 150px); min-height: 560px; }
    .side { display: flex; flex-direction: column; gap: 10px; align-self: start; }
    .side p { margin: 0; }
    .steps { margin: 0; padding-left: 18px; display: grid; gap: 6px; }
    @media (max-width: 900px) {
      .paths, .interview { grid-template-columns: 1fr; }
      .interview { height: auto; }
      .interview nx-copilot-panel { height: 75dvh; }
    }
  `,
})
export class AgentNewPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  readonly plantilla = input<string | undefined>(undefined);
  readonly modo = input<string | undefined>(undefined);
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  readonly templates = [...INDUSTRY_TEMPLATES, BLANK_TEMPLATE];
  readonly roles = ROLE_TEMPLATES;
  readonly template = signal<IndustryTemplate | null>(null);
  readonly creating = signal(false);
  name = '';
  roleId = '';

  ngOnInit() {
    const t = this.templates.find((x) => x.id === this.plantilla());
    if (t) this.template.set(t);
    else if (this.modo() === 'experto') setTimeout(() => this.nameInput()?.nativeElement.focus());
  }

  start(t: IndustryTemplate) {
    this.template.set(t);
    window.scrollTo({ top: 0 });
  }

  goExpert() {
    this.template.set(null);
    setTimeout(() => this.nameInput()?.nativeElement.focus());
  }

  async onApplied(ev: { proposal: CopilotProposal; result: CopilotApplyResult }) {
    const { agentId, ...summary } = ev.result;
    if (!agentId) return;
    // La tarjeta se destruye al navegar: el resumen (integraciones pendientes y avisos) viaja como estado de navegación.
    const state: CopilotApplyNavigationState = { copilotApply: summary };
    await this.router.navigate(['/agents', agentId], { state });
  }

  async createEmpty() {
    if (this.creating() || this.name.trim().length < 2) return;
    this.creating.set(true);
    try {
      const providers = await this.api.llmCatalog().catch(() => this.api.providers());
      const anthropic = providers.find((p) => p.id === 'anthropic');
      const provider = anthropic?.configured ? anthropic : providers.find((p) => p.configured);
      if (!provider?.models.length) throw new Error('No hay proveedores de IA configurados. Pida a un administrador que configure uno.');
      const role = this.roles.find((r) => r.id === this.roleId);
      const agent = await this.api.createAgent({
        name: this.name.trim(),
        provider: provider.id,
        model: provider.models[0]!.id,
        systemPrompt: role ? '' : DEFAULT_PROMPT,
        ...(role ? { profile: role.profile } : {}),
      });
      await this.router.navigate(['/agents', agent.id]);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.creating.set(false);
    }
  }
}
