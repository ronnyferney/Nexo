import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { PlatformApi } from '../../core/platform.api';
import { PageHeaderComponent } from '../../layout/page-header.component';
import { IconComponent } from '../../shared/icon.component';

type Scope = 'all' | 'admin' | 'platform';
interface SettingCard {
  icon: string;
  title: string;
  desc: string;
  link: string;
  scope: Scope;
}
interface SettingSection {
  title: string;
  cards: SettingCard[];
}

/** Secciones del hub de Ajustes: "el resto de la configuración" que no vive en el menú principal. */
const SECTIONS: readonly SettingSection[] = [
  {
    title: 'Conexiones y canales',
    cards: [
      { icon: 'plug', title: 'Conectores', desc: 'Conectores REST, SOAP, GraphQL y MCP e importación de operaciones.', link: '/connectors', scope: 'all' },
      { icon: 'send', title: 'Canales externos', desc: 'Cuentas de correo y WhatsApp por empresa (sandbox).', link: '/canales-externos', scope: 'admin' },
      { icon: 'headset', title: 'Voz', desc: 'Telefonía y asistentes de voz (sandbox, sin gasto).', link: '/voz', scope: 'admin' },
      { icon: 'server', title: 'Estaciones virtuales', desc: 'Entornos de ejecución de los empleados digitales.', link: '/admin/estaciones-virtuales', scope: 'admin' },
      { icon: 'server', title: 'Nexo Edge', desc: 'Nodos de ejecución cercanos a tus sistemas.', link: '/admin/edges', scope: 'admin' },
    ],
  },
  {
    title: 'Organización',
    cards: [
      { icon: 'building', title: 'Organización', desc: 'Datos y preferencias del espacio de trabajo.', link: '/admin/organization', scope: 'admin' },
      { icon: 'subunit', title: 'Estructura', desc: 'Empresas, unidades de negocio y áreas.', link: '/admin/estructura', scope: 'admin' },
      { icon: 'hash', title: 'Dimensiones', desc: 'Dimensiones configurables (sedes, centros de costo, proyecto).', link: '/admin/dimensiones', scope: 'admin' },
      { icon: 'users', title: 'Grupos', desc: 'Grupos de personas y asignaciones.', link: '/admin/groups', scope: 'admin' },
    ],
  },
  {
    title: 'Workspace y seguridad',
    cards: [
      { icon: 'settings', title: 'Ajustes generales', desc: 'Preferencias generales del espacio de trabajo.', link: '/admin/settings', scope: 'admin' },
      { icon: 'shield', title: 'Seguridad', desc: 'Protección de datos, retención y controles de seguridad.', link: '/admin/security', scope: 'admin' },
      { icon: 'lock', title: 'Auditoría', desc: 'Registro inmutable de los hechos de gobierno.', link: '/auditoria', scope: 'admin' },
    ],
  },
  {
    title: 'Economía',
    cards: [
      { icon: 'wallet', title: 'Presupuestos', desc: 'Límites de gasto por empresa, línea y período.', link: '/admin/budgets', scope: 'admin' },
      { icon: 'scale', title: 'Imputación de costos', desc: 'Reglas de imputación y servicios compartidos.', link: '/admin/imputacion', scope: 'admin' },
    ],
  },
  {
    title: 'Plataforma Nexo',
    cards: [
      { icon: 'trophy', title: 'Éxito de clientes', desc: 'Panel de éxito de clientes de la plataforma.', link: '/platform', scope: 'platform' },
      { icon: 'sparkles', title: 'Calidad del Copilot', desc: 'Métricas de calidad del copiloto de Nexo.', link: '/platform/copilot-quality', scope: 'platform' },
      { icon: 'plug', title: 'Apps de inicio de sesión', desc: 'Aplicaciones OAuth de inicio de sesión.', link: '/platform/oauth-apps', scope: 'platform' },
    ],
  },
];

/**
 * Hub de Ajustes: una única página que reúne «el resto de la configuración» que se sacó del menú lateral para
 * dejarlo con tres utilidades (Conecta tus apps, Conecta tu IA, Ajustes). Muestra tarjetas agrupadas y filtradas por
 * rol; cada una enlaza a la pantalla de configuración correspondiente. No cambia rutas ni permisos: solo las reúne.
 */
@Component({
  selector: 'nx-ajustes-hub',
  imports: [RouterLink, PageHeaderComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nx-page-header hostClass="brand-hero" heading="Ajustes"
        description="Aquí reunimos el resto de la configuración del espacio de trabajo." />

      @for (section of sections(); track section.title) {
        <section class="sec" [attr.aria-label]="section.title">
          <h2 class="sec-title">{{ section.title }}</h2>
          <div class="grid">
            @for (c of section.cards; track c.link) {
              <a class="card hover setting" [routerLink]="c.link">
                <div class="icon-tile"><nx-icon [name]="c.icon" [size]="18" /></div>
                <div class="body">
                  <strong>{{ c.title }}</strong>
                  <span class="muted small">{{ c.desc }}</span>
                </div>
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
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
    a.setting { display: flex; align-items: center; gap: 12px; padding: 14px 16px; text-decoration: none; color: inherit; }
    a.setting .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    a.setting .body strong { color: var(--text); font-size: 14.5px; }
    a.setting .go { color: var(--text-muted, #8f98c2); flex-shrink: 0; }
    a.setting:hover .go { color: var(--brand-cyan, #16C7F4); }
  `,
})
export class AjustesHubPage {
  private readonly auth = inject(AuthService);
  private readonly platform = inject(PlatformApi);

  /** Secciones visibles según el rol: se descartan tarjetas y secciones que el usuario no puede ver. */
  protected readonly sections = computed(() => {
    const isAdmin = this.auth.isAdmin();
    const isPlatform = !!this.platform.isPlatformAdmin();
    const can = (s: Scope) => s === 'all' || (s === 'admin' && isAdmin) || (s === 'platform' && isPlatform);
    return SECTIONS.map((sec) => ({ ...sec, cards: sec.cards.filter((c) => can(c.scope)) })).filter((sec) => sec.cards.length > 0);
  });
}
