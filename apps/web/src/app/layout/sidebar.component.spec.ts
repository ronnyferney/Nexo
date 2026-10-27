import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { PlatformApi } from '../core/platform.api';
import { LayoutService } from './layout.service';
import { SidebarComponent } from './sidebar.component';

/** Stubs mínimos basados en signals: el menú solo lee estado de sesión y rol. */
function makeAuth() {
  return {
    me: signal<any>(null),
    isAdmin: signal(false),
    logout: jasmine.createSpy('logout'),
    switchWorkspace: jasmine.createSpy('switchWorkspace').and.resolveTo(undefined),
  };
}

describe('SidebarComponent (lista con nombres → submenú al pulsar)', () => {
  let fixture: ComponentFixture<SidebarComponent>;
  let el: HTMLElement;
  let auth: ReturnType<typeof makeAuth>;
  let layout: LayoutService;

  const menuItems = () => el.querySelectorAll<HTMLElement>('.list .m-item');
  const panelLinks = () => el.querySelectorAll<HTMLAnchorElement>('.panel a.nav-link');
  const panelPaths = () => [...panelLinks()].map((a) => a.getAttribute('href') ?? '');
  const search = (text: string) => {
    const input = el.querySelector('.filter input') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  /** Pulsa el menú mayor cuyo nombre coincide (sea enlace o botón). */
  const clickMenu = (label: string) => {
    const item = [...menuItems()].find((m) => m.querySelector('.lbl')?.textContent?.trim() === label);
    (item as HTMLElement).click();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    try {
      localStorage.clear();
    } catch {
      /* sin almacenamiento */
    }
    auth = makeAuth();
    await TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: PlatformApi, useValue: { isPlatformAdmin: signal(false) } },
      ],
    }).compileComponents();
    layout = TestBed.inject(LayoutService);
    fixture = TestBed.createComponent(SidebarComponent);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('por defecto muestra la lista con nombres (marca, filtro) y sin submenús', () => {
    expect(el.querySelector('.list')).not.toBeNull();
    expect(el.querySelector('.rail')).toBeNull();
    expect(el.querySelector('.panel')).toBeNull();
    expect(el.querySelector('.brand')?.getAttribute('aria-label')).toContain('Nexo');
    expect(el.querySelector('.list nav')?.getAttribute('aria-label')).toBe('Navegación principal');
    expect(el.querySelector('.filter input')?.getAttribute('aria-label')).toBe('Buscar en el menú');
  });

  it('un VIEWER ve 8 menús mayores con nombre (6 principales + 2 utilidades); ninguna ruta de admin', () => {
    expect(menuItems().length).toBe(8);
    search('políticas');
    expect([...menuItems()].length).toBe(0); // políticas es admin: sin resultados para VIEWER
  });

  it('un admin ve 10 menús mayores (incluye Organización y «Conecta tu IA»)', () => {
    auth.isAdmin.set(true);
    fixture.detectChanges();
    expect(menuItems().length).toBe(10);
  });

  it('marca el ítem activo con aria-current en la lista (ruta inicial «/»)', () => {
    const active = el.querySelector('.list a.m-item.active');
    expect(active?.getAttribute('aria-current')).toBe('page');
    expect(active?.getAttribute('href')).toBe('/');
  });

  it('al pulsar un menú mayor con sub-ítems, aparece el riel + su submenú', () => {
    expect(el.querySelector('.panel')).toBeNull();
    clickMenu('Agentes');
    expect(el.querySelector('.rail')).not.toBeNull();
    expect(el.querySelector('.panel')).not.toBeNull();
    expect(el.querySelector('.panel-head strong')?.textContent).toContain('Agentes');
    expect(panelPaths()).toContain('/agents');
    expect(panelPaths()).toContain('/skills');
    // «Volver al menú» cierra el submenú y regresa a la lista.
    (el.querySelector('.panel-head .back') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.panel')).toBeNull();
    expect(el.querySelector('.list')).not.toBeNull();
  });

  it('un menú de un solo destino (Inicio) es enlace directo, no abre submenú', () => {
    clickMenu('Inicio');
    expect(el.querySelector('.panel')).toBeNull();
    expect(el.querySelector('.list')).not.toBeNull();
  });

  it('busca en todas las áreas y muestra el estado vacío sin coincidencias', () => {
    search('skills');
    expect([...menuItems()].map((m) => m.getAttribute('href'))).toContain('/skills');
    search('xyz-no-existe');
    expect(menuItems().length).toBe(0);
    expect(el.querySelector('.list .empty')).not.toBeNull();
  });

  it('al colapsar (toolbar/riel) queda solo el riel de iconos', () => {
    expect(el.querySelector('.list')).not.toBeNull();
    (el.querySelector('.list-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(layout.panelHidden()).toBeTrue();
    expect(el.querySelector('.list')).toBeNull();
    expect(el.querySelector('.rail')).not.toBeNull();
    expect(el.querySelector('.nav.collapsed')).not.toBeNull();
  });

  it('el menú de usuario ya no vive en el menú lateral (está en el toolbar)', () => {
    auth.me.set({ name: 'Ana', email: 'ana@acme.co', activeWorkspaceId: 'w1', memberships: [{ workspace: { id: 'w1', name: 'Acme' } }] });
    fixture.detectChanges();
    expect(el.querySelector('.rail-user')).toBeNull();
    expect(el.querySelector('.user-menu')).toBeNull();
  });
});
