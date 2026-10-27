import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { PlatformApi } from '../core/platform.api';
import { SidebarComponent } from './sidebar.component';
import { TopbarComponent } from './topbar.component';

/**
 * Shell de la aplicación: compone el «chrome» persistente (barra lateral) con el área de contenido
 * donde se proyectan las páginas enrutadas. Al iniciar carga la sesión (`AuthService`) y el estado
 * de plataforma (`PlatformApi`); la presentación de la navegación vive en `nx-sidebar`.
 */
@Component({
  selector: 'nx-shell',
  imports: [RouterOutlet, SidebarComponent, TopbarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nx-sidebar />
    <div class="col">
      <nx-topbar />
      <main><router-outlet /></main>
    </div>
  `,
  styles: `
    :host { display: flex; min-height: 100vh; }
    .col { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    main { flex: 1; min-width: 0; }
    @media (max-width: 900px) { :host { flex-direction: column; } }
  `,
})
export class ShellComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly platform = inject(PlatformApi);

  ngOnInit() {
    void this.auth.loadMe();
    void this.platform.loadMe();
  }
}
