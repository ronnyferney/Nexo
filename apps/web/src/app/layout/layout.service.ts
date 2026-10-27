import { Injectable, signal } from '@angular/core';

/** Clave de `localStorage` donde se recuerda si el panel secundario del menú está oculto (por visor). */
const PANEL_STORE_KEY = 'nexo.sidebar.panelHidden';

function loadPanelHidden(): boolean {
  try {
    return localStorage.getItem(PANEL_STORE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Estado compartido del «chrome» de la aplicación. Centraliza si el panel secundario del menú está colapsado,
 * para que lo gobiernen por igual el riel (botón propio) y el toolbar superior. Se recuerda por visor.
 */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  /** Panel secundario colapsado (solo queda el riel de iconos). */
  readonly panelHidden = signal<boolean>(loadPanelHidden());

  togglePanel(): void {
    this.setPanelHidden(!this.panelHidden());
  }

  setPanelHidden(hidden: boolean): void {
    this.panelHidden.set(hidden);
    try {
      localStorage.setItem(PANEL_STORE_KEY, hidden ? '1' : '0');
    } catch {
      /* almacenamiento no disponible: no se recuerda, pero la UI sigue funcionando */
    }
  }
}
