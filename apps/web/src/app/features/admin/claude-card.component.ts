import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { ProviderView } from '../../core/llm-providers.models';
import { IconComponent } from '../../shared/icon.component';
import { BrandLogoComponent } from '../integrations/brand-logo.component';
import { providerLogo } from './ai-provider-logos';

/** Tarjeta destacada «Claude» de «Disponibles»: la familia con sus canales oficiales. */
export interface ClaudeCard {
  models: string;
  channels: { p: ProviderView; short: string; highlighted: boolean; connected: boolean }[];
  /** Canales que coinciden con la búsqueda o el filtro (vacío si coinciden todos o no se filtra). */
  highlight: string[];
  /** Canal con un inicio de sesión en curso. */
  pending: { p: ProviderView; short: string } | null;
  /** Modelo que coincidió con la búsqueda («Incluye Claude Opus 5.5»). */
  matchedModel: string | null;
}

/**
 * Claude es una familia de modelos, no un proveedor más: se presenta una sola vez, antes de las categorías, con sus
 * modelos y los canales por los que se llega a ellos. «Conectar» abre la comparación de canales.
 */
@Component({
  selector: 'nx-claude-card',
  imports: [IconComponent, BrandLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let cl = card();
    <div class="claude-card" [class.hl]="cl.highlight.length" role="group" aria-labelledby="claude-name" aria-describedby="claude-models claude-ch">
      <nx-brand-logo [entry]="entry" [logo]="logo" [size]="52" />
      <div class="cl-body">
        <span class="cl-name"><strong id="claude-name">Claude</strong><span class="badge">Familia de modelos de Anthropic</span></span>
        <span class="cl-models" id="claude-models">@if (cl.matchedModel) { Incluye {{ cl.matchedModel }} · } {{ cl.models }}</span>
        @if (cl.pending; as pd) {
          <span class="wait" role="status"><span class="spin" aria-hidden="true"></span>Conectando vía {{ pd.short }}…<span class="sr-only"> Complete el inicio de sesión en la ventana emergente.</span></span>
        } @else {
          <span class="cl-ch" id="claude-ch"><span class="lbl">Disponible vía</span>
            @for (ch of cl.channels; track ch.p.id) {
              <button type="button" class="ch-chip" [class.on]="ch.highlighted"
                [attr.aria-label]="'Conectar Claude vía ' + ch.short + (ch.highlighted ? ' (coincide con su búsqueda)' : '') + (ch.connected ? ' (ya conectado)' : '')"
                [title]="ch.p.name" (click)="channel.emit({ p: ch.p, el: $any($event.currentTarget) })">{{ ch.short }}@if (ch.connected) { <nx-icon name="check" [size]="12" /> }</button>
            }
          </span>
        }
      </div>
      @if (cl.pending; as pd) {
        <button type="button" class="btn pill" [id]="'cancel-' + pd.p.id" (click)="cancel.emit(pd.p)">Cancelar</button>
      } @else {
        <button type="button" class="btn primary pill go" id="claude-connect" (click)="connect.emit($any($event.currentTarget))">Conectar</button>
      }
    </div>
  `,
  styles: `
    .claude-card { display: flex; align-items: center; gap: 16px; padding: 16px 18px; margin: 4px 0 8px; border-radius: 16px; min-width: 0;
      border: 1.5px solid transparent; background: linear-gradient(var(--surface), var(--surface)) padding-box, var(--brand-gradient) border-box; }
    .claude-card.hl { box-shadow: 0 0 0 3px var(--primary-50); }
    .cl-body { flex: 1; min-width: 0; display: grid; gap: 4px; }
    .cl-name { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .cl-name strong { font-size: 17px; font-weight: 700; }
    .cl-models { font-size: 13.5px; font-weight: 550; }
    .cl-ch { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
    .lbl { color: var(--muted); font-size: 12.5px; margin-right: 2px; }
    .ch-chip { height: 26px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text);
      font: inherit; font-size: 12.5px; font-weight: 550; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
    .ch-chip:hover { border-color: var(--primary); color: var(--primary); }
    .ch-chip.on { background: var(--primary-50); border-color: var(--primary); color: var(--primary); }
    .ch-chip:focus-visible, .btn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .pill { border-radius: 999px; height: 40px; padding: 0 22px; flex-shrink: 0; }
    .wait { display: flex; align-items: center; gap: 8px; color: var(--primary); font-size: 13px; }
    .spin { width: 13px; height: 13px; border-radius: 50%; border: 2px solid var(--border); border-top-color: var(--primary); animation: spin 0.7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 560px) {
      .claude-card { flex-wrap: wrap; padding: 14px; gap: 12px; }
      .cl-body { flex-basis: calc(100% - 64px); }
      .pill { width: 100%; justify-content: center; }
    }
    @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
  `,
})
export class ClaudeCardComponent {
  readonly card = input.required<ClaudeCard>();
  /** «Conectar»: la página abre «Conectar Claude» (el elemento recibe el foco al cerrar). */
  readonly connect = output<HTMLElement>();
  /** Chip de un canal: la página abre directamente el diálogo de conexión de esa entrada. */
  readonly channel = output<{ p: ProviderView; el: HTMLElement }>();
  readonly cancel = output<ProviderView>();

  readonly entry = { id: 'claude', name: 'Claude' };
  readonly logo = providerLogo({ id: 'claude', name: 'Claude', logo: 'claude' });
}
