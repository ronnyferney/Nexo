import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type BrandLogo, brandLogo } from './integration-logos';

/**
 * Logo de marca de una integración del catálogo (SVG en línea, sin `innerHTML`); decorativo por defecto.
 * `[logo]` permite pasar un logo ya resuelto desde otro mapa (p. ej. proveedores de IA) sin cargarlo aquí.
 */
@Component({
  selector: 'nx-brand-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--logo-size.px]': 'size()', 'aria-hidden': 'true' },
  template: `
    @let l = logo();
    @if (l.kind === 'shapes') {
      <svg viewBox="0 0 24 24" focusable="false">
        @for (s of l.shapes; track $index) {
          @if ('d' in s) { <path [attr.d]="s.d" [attr.fill]="s.fill" />
          } @else if ('r' in s) { <circle [attr.cx]="s.cx" [attr.cy]="s.cy" [attr.r]="s.r" [attr.fill]="s.fill" />
          } @else { <rect [attr.x]="s.x" [attr.y]="s.y" [attr.width]="s.w" [attr.height]="s.h" [attr.rx]="s.rx ?? 0" [attr.fill]="s.fill" /> }
        }
      </svg>
    } @else {
      <span class="mono" [style.background]="l.color">{{ l.text }}</span>
    }
  `,
  styles: `
    :host { color: var(--text); display: inline-grid; place-items: center; width: var(--logo-size); height: var(--logo-size); flex-shrink: 0; }
    svg { width: 82%; height: 82%; display: block; }
    .mono { width: 100%; height: 100%; display: grid; place-items: center; border-radius: 22%; color: #fff;
      font-weight: 700; font-size: calc(var(--logo-size) * 0.5); line-height: 1; letter-spacing: -0.02em; }
  `,
})
export class BrandLogoComponent {
  readonly entry = input.required<{ id: string; name: string }>();
  readonly size = input(44);
  readonly custom = input<BrandLogo | null>(null, { alias: 'logo' });
  readonly logo = computed(() => this.custom() ?? brandLogo(this.entry()));
}
