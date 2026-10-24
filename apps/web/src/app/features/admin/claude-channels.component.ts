import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';
import type { ProviderView } from '../../core/llm-providers.models';
import { IconComponent } from '../../shared/icon.component';
import { BrandLogoComponent } from '../integrations/brand-logo.component';
import { providerLogo } from './ai-provider-logos';
import {
  CLAUDE_CHANNEL_ORDER,
  CLAUDE_CHANNELS,
  type ClaudeChannelInfo,
  claudeChannelOf,
  claudeModelsLine,
  primaryMechanism,
} from './provider-meta';

interface ChannelOption {
  p: ProviderView;
  info: ClaudeChannelInfo;
  recommended: boolean;
  available: boolean;
  reason: string | null;
  connected: number;
  highlighted: boolean;
}

/**
 * Diálogo «Conectar Claude»: los modelos son los mismos en todos los canales oficiales; el usuario elige por cuál
 * accede su organización (quién opera el servicio, cómo se conecta y quién factura). Al elegir, la página abre el
 * diálogo de conexión de esa entrada.
 */
@Component({
  selector: 'nx-claude-channels',
  imports: [IconComponent, BrandLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="modal channels" aria-labelledby="cc-title" aria-describedby="cc-sub" (close)="closed.emit()">
      <div class="modal-body">
        <div class="head">
          <nx-brand-logo [entry]="logoEntry" [logo]="logo" [size]="44" />
          <div class="grow">
            <h2 id="cc-title">Conectar Claude</h2>
            <p class="models">{{ models() }}</p>
          </div>
          <button type="button" class="btn ghost icon" aria-label="Cerrar" title="Cerrar" (click)="close()"><nx-icon name="x" /></button>
        </div>
        <p id="cc-sub" class="sub">Los modelos son los mismos en todos los canales. Elija por cuál accede su organización: cambia quién opera el servicio, cómo inicia sesión y quién factura.</p>

        <ul class="opts" aria-label="Canales de Claude">
          @for (o of options(); track o.p.id) {
            <li>
              <button type="button" class="opt" [class.hl]="o.highlighted" [class.off]="!o.available" [attr.data-channel]="o.p.id"
                [attr.aria-disabled]="!o.available" [attr.aria-describedby]="'ch-st-' + o.p.id" (click)="pick(o)">
                <span class="o-head">
                  <strong>{{ o.info.short }}</strong>
                  @if (o.recommended) { <span class="badge primary">Recomendado</span> }
                  @if (o.connected) { <span class="badge success">{{ o.connected === 1 ? 'Conectado' : o.connected + ' conexiones' }}</span> }
                  @if (o.highlighted) { <span class="badge info">Coincide con su búsqueda</span> }
                </span>
                <dl class="facts">
                  <div><dt>Operado por</dt><dd>{{ o.info.operator }}</dd></div>
                  <div><dt>Conexión</dt><dd>{{ o.info.how }}</dd></div>
                  <div><dt>Factura</dt><dd>{{ o.info.billing }}</dd></div>
                </dl>
                <span class="o-foot" [id]="'ch-st-' + o.p.id">
                  @if (o.available) {
                    <span class="ok"><nx-icon name="checkCircle" [size]="14" />Disponible</span><span class="muted"> · {{ o.info.note }}</span>
                  } @else {
                    <span class="na"><nx-icon name="lock" [size]="14" />{{ o.reason }}</span>
                  }
                </span>
                @if (o.available) { <span class="go" aria-hidden="true"><nx-icon name="chevronDown" [size]="16" /></span> }
              </button>
            </li>
          } @empty {
            <li class="empty-ch muted">No hay canales de Claude publicados en el catálogo.</li>
          }
        </ul>

        <div class="callout info"><nx-icon name="info" [size]="16" />
          <span>Nexo no usa suscripciones personales como Claude Pro o Max: los términos de Anthropic no permiten usarlas en aplicaciones de terceros.</span></div>
        @if (platformConfigured() === true) {
          <p class="small muted plat">Claude ya está incluido por Nexo con la cuenta de la plataforma. Conecte un canal propio para usar la cuenta y la facturación de su organización.</p>
        } @else if (platformConfigured() === false) {
          <p class="small muted plat">Su administrador de Nexo puede incluir Claude con la cuenta de la plataforma.</p>
        }

        <div class="foot"><button type="button" class="btn pill" (click)="close()">Cancelar</button></div>
      </div>
    </dialog>
  `,
  styles: `
    dialog.channels { width: min(760px, calc(100vw - 24px)); border-radius: 18px; }
    .modal-body { padding: 22px 24px 20px; gap: 16px; }
    .head { display: flex; gap: 14px; align-items: center; }
    .head h2 { font-size: 20px; margin-bottom: 2px; }
    .grow { flex: 1; min-width: 0; }
    .models { margin: 0; color: var(--muted); font-size: 13px; font-weight: 600; }
    .sub { margin: -4px 0 0; color: var(--muted); line-height: 1.55; }
    .opts { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .opts li { display: flex; min-width: 0; }
    .opt { position: relative; width: 100%; display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--border);
      border-radius: 14px; background: var(--surface); color: inherit; font: inherit; text-align: left; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
    .opt:hover:not(.off) { border-color: var(--primary); background: var(--primary-50); }
    .opt:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .opt.hl { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary); }
    .opt.off { cursor: not-allowed; background: var(--surface-2); }
    .o-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding-right: 22px; }
    .o-head strong { font-size: 15px; margin-right: 2px; }
    .facts { margin: 0; display: grid; gap: 4px; font-size: 13px; }
    .facts div { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 8px; }
    .facts dt { color: var(--muted); }
    .facts dd { margin: 0; font-weight: 550; overflow-wrap: anywhere; }
    .o-foot { margin-top: auto; font-size: 12.5px; }
    .ok, .na { display: inline-flex; gap: 5px; align-items: flex-start; font-weight: 600; }
    .ok { color: var(--success); }
    .na { color: var(--muted); font-weight: 500; }
    .ok nx-icon, .na nx-icon { margin-top: 1px; flex-shrink: 0; }
    .go { position: absolute; top: 14px; right: 14px; color: var(--muted); transform: rotate(-90deg); }
    .opt:hover .go, .opt:focus-visible .go { color: var(--primary); }
    .plat { margin: -6px 0 0; }
    .empty-ch { padding: 12px; }
    .foot { display: flex; justify-content: flex-end; }
    .pill { border-radius: 999px; height: 40px; padding: 0 18px; }
    @media (max-width: 640px) {
      .opts { grid-template-columns: minmax(0, 1fr); }
      .modal-body { padding: 18px 16px; }
      .foot .btn { flex: 1 1 auto; justify-content: center; }
    }
  `,
})
export class ClaudeChannelsComponent {
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  /** Entradas de la familia Claude (`family: 'CLAUDE'`). */
  readonly channels = input.required<ProviderView[]>();
  /** Ids de los canales que coinciden con la búsqueda o el filtro de la galería (se resaltan). */
  readonly highlight = input<readonly string[]>([]);
  /** Estado de la conexión «Incluido por Nexo» (`null` si el servidor no la informa). */
  readonly platformConfigured = input<boolean | null>(null);
  readonly closed = output<void>();
  readonly chosen = output<ProviderView>();

  readonly logoEntry = { id: 'claude', name: 'Claude' };
  readonly logo = providerLogo({ id: 'claude', name: 'Claude', logo: 'claude' });

  /** «Opus 5.5 · Sonnet 5.5 · Haiku 5.5 · Fable 5.1», del canal directo o de cualquiera de la familia. */
  readonly models = computed(() => claudeModelsLine(this.channels()));

  readonly options = computed<ChannelOption[]>(() => {
    const hl = new Set(this.highlight());
    const rank = (p: ProviderView) => {
      const i = CLAUDE_CHANNEL_ORDER.indexOf(claudeChannelOf(p));
      return i < 0 ? CLAUDE_CHANNEL_ORDER.length : i;
    };
    return [...this.channels()]
      .sort((a, b) => rank(a) - rank(b))
      .map((p) => {
        const ch = claudeChannelOf(p);
        const m = primaryMechanism(p);
        return {
          p,
          info: CLAUDE_CHANNELS[ch],
          recommended: ch === 'anthropic',
          available: m.available,
          reason: m.available ? null : m.unavailableReason || 'No disponible por ahora.',
          connected: p.connected?.length ?? 0,
          highlighted: hl.has(p.id),
        };
      });
  });

  constructor() {
    afterNextRender(() => {
      const dlg = this.dialog().nativeElement;
      dlg.showModal();
      const first =
        dlg.querySelector<HTMLElement>('.opt.hl:not(.off)') ?? dlg.querySelector<HTMLElement>('.opt:not(.off)') ?? dlg.querySelector<HTMLElement>('.opt');
      first?.focus();
    });
  }

  pick(o: ChannelOption) {
    if (!o.available) return;
    this.chosen.emit(o.p);
  }

  close() {
    this.dialog().nativeElement.close();
  }
}

