import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { PlatformApi } from '../../core/platform.api';
import { PageHeaderComponent } from '../../layout/page-header.component';
import { IconComponent } from '../../shared/icon.component';
import { AJUSTES_GROUPS } from './ajustes-shell.component';

type Scope = 'all' | 'admin' | 'platform';

/**
 * Bienvenida del espacio de Ajustes: se muestra en el panel de detalle al entrar a /ajustes, mientras no se
 * elige una sección en la barra lateral. Repite el catálogo como accesos directos (filtrado por rol) para que
 * quien llega vea de un vistazo todo lo configurable. No cambia rutas ni permisos: solo los reúne.
 */
@Component({
  selector: 'nx-ajustes-hub',
  imports: [RouterLink, PageHeaderComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nx-page-header hostClass="brand-hero" heading="Ajustes"
        description="Elige una sección en la barra lateral o usa un acceso directo." />

      @for (section of sections(); track section.title) {
        <section class="sec" [attr.aria-label]="section.title">
          <h2 class="sec-title">{{ section.title }}</h2>
          <div class="grid">
            @for (c of section.items; track c.path) {
              <a class="card hover setting" [routerLink]="c.path">
                <div class="icon-tile"><nx-icon [name]="c.icon" [size]="18" /></div>
                <div class="body"><strong>{{ c.label }}</strong></div>
                <nx-icon class="go" name="arrowRight" [size]="16" />
              </a>
            }
          </div>
        </section>
      } @empty {
        <div class="card"><p class="muted">No tienes secciones de configuración disponibles con tu rol.</p></div>
      }
    </div>
  `,
  styles: `
    .page { display: flex; flex-direction: column; gap: 18px; }
    .sec-title { font-size: 14px; font-weight: 800; color: var(--text); margin: 4px 0 10px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    a.setting { display: flex; align-items: center; gap: 12px; padding: 12px 14px; text-decoration: none; color: inherit; }
    a.setting .body { flex: 1; min-width: 0; }
    a.setting .body strong { color: var(--text); font-size: 14px; }
    a.setting .go { color: var(--text-muted, #8f98c2); flex-shrink: 0; }
    a.setting:hover .go { color: var(--brand-cyan, #16C7F4); }
  `,
})
export class AjustesHubPage {
  private readonly auth = inject(AuthService);
  private readonly platform = inject(PlatformApi);

  /** Secciones visibles según el rol: se descartan ítems y secciones que el usuario no puede ver. */
  protected readonly sections = computed(() => {
    const isAdmin = this.auth.isAdmin();
    const isPlatform = !!this.platform.isPlatformAdmin();
    const can = (s: Scope) => s === 'all' || (s === 'admin' && isAdmin) || (s === 'platform' && isPlatform);
    return AJUSTES_GROUPS.map((sec) => ({ ...sec, items: sec.items.filter((c) => can(c.scope)) })).filter((sec) => sec.items.length > 0);
  });
}
