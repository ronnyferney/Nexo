import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '../../shared/icon.component';

/** Pestañas de la consola de plataforma Nexo. */
@Component({
  selector: 'nx-platform-nav',
  imports: [RouterLink, RouterLinkActive, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="tabs" aria-label="Consola de plataforma">
      <a class="tab" routerLink="/platform" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" ariaCurrentWhenActive="page">Éxito de clientes</a>
      <a class="tab" routerLink="/platform/copilot-quality" routerLinkActive="active" ariaCurrentWhenActive="page">Calidad del Copilot</a>
      <a class="tab" routerLink="/platform/oauth-apps" routerLinkActive="active" ariaCurrentWhenActive="page">Apps de inicio de sesión</a>
    </nav>
    <div class="callout info" style="margin-bottom:16px">
      <nx-icon name="shield" [size]="16" />
      <span>Consola interna de Nexo (no visible para los clientes). Solo métricas agregadas: el contenido de conversaciones aparece
        únicamente cuando el usuario decidió compartirlo al calificar una respuesta del Copilot.</span>
    </div>
  `,
})
export class PlatformNavComponent {}
