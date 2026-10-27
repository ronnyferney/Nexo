import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { PlatformApi } from '../core/platform.api';
import { SidebarComponent } from './sidebar.component';

/** Stubs mínimos basados en signals: el sidebar solo lee estado de sesión y rol. */
function makeAuth() {
  return {
    me: signal<any>(null),
    isAdmin: signal(false),
    logout: jasmine.createSpy('logout'),
    switchWorkspace: jasmine.createSpy('switchWorkspace').and.resolveTo(undefined),
  };
}

describe('SidebarComponent (navegación de dos niveles)', () => {
  let fixture: ComponentFixture<SidebarComponent>;
  let el: HTMLElement;
  let auth: ReturnType<typeof makeAuth>;
  let platform: { isPlatformAdmin: ReturnType<typeof signal<boolean>> };

  const areaBtns = () => el.querySelectorAll<HTMLButtonElement>('.rail .rail-ico.area');
  const panelLinks = () => el.querySelectorAll<HTMLAnchorElement>('.panel a.nav-link');
  const panelPaths = () => [...panelLinks()].map((a) => a.getAttribute('href') ?? '');
  const search = (text: string) => {
    const input = el.querySelector('.filter input') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    try {
      localStorage.clear();
    } catch {
      /* sin almacenamiento */
    }
    auth = makeAuth();
    platform = { isPlatformAdmin: signal(false) };
    await TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: PlatformApi, useValue: platform },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SidebarComponent);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('renderiza el riel, la marca, el panel y el filtro accesibles', () => {
    expect(el.querySelector('.brand-ico')?.getAttribute('aria-label')).toContain('Nexo');
    expect(el.querySelector('.panel nav')?.getAttribute('aria-label')).toBe('Navegación principal');
    expect(el.querySelector('.filter input')?.getAttribute('aria-label')).toBe('Buscar en el menú');
    expect(el.querySelector('.rail-areas')?.getAttribute('aria-label')).toBe('Áreas');
  });

  it('un VIEWER ve 7 áreas en el riel y ninguna ruta de admin/plataforma en el panel', () => {
    // home, work, agents, comms, org, governance, finance (dirección/admin/plataforma ocultas al VIEWER).
    expect(areaBtns().length).toBe(7);
    // Buscar entre TODAS las áreas no revela rutas de admin/plataforma.
    search('políticas');
    expect(panelPaths().some((p) => p.startsWith('/admin'))).toBeFalse();
    search('inicio de sesión');
    expect(panelPaths().some((p) => p.startsWith('/platform'))).toBeFalse();
  });

  it('el panel muestra el área activa y marca el ítem activo con aria-current (ruta inicial «/»)', () => {
    const active = el.querySelector('.panel a.nav-link.active');
    expect(active?.getAttribute('aria-current')).toBe('page');
    expect(active?.getAttribute('href')).toBe('/');
  });

  it('busca en todas las áreas y muestra el estado vacío sin coincidencias', () => {
    search('skills');
    expect(panelPaths()).toEqual(['/skills']);
    expect(el.querySelector('.panel-head strong')?.textContent).toContain('Resultados');

    search('xyz-no-existe');
    expect(panelLinks().length).toBe(0);
    expect(el.querySelector('.panel .empty')).not.toBeNull();
  });

  it('oculta y muestra el panel secundario (solo riel)', () => {
    expect(el.querySelector('.panel')).not.toBeNull();
    const toggle = el.querySelector('.rail-toggle') as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();
    expect(el.querySelector('.panel')).toBeNull();
    expect(el.querySelector('.nav.panel-hidden')).not.toBeNull();
    toggle.click();
    fixture.detectChanges();
    expect(el.querySelector('.panel')).not.toBeNull();
  });

  it('muestra rutas de administración cuando el usuario es admin', () => {
    auth.isAdmin.set(true);
    fixture.detectChanges();
    search('políticas');
    expect(panelPaths()).toContain('/admin/politicas');
    search('canales externos');
    expect(panelPaths()).toContain('/canales-externos');
    search('inicio de sesión');
    expect(panelPaths().some((p) => p.startsWith('/platform'))).toBeFalse();
  });

  it('muestra rutas de plataforma cuando es admin de plataforma', () => {
    platform.isPlatformAdmin.set(true);
    fixture.detectChanges();
    search('inicio de sesión');
    expect(panelPaths()).toContain('/platform/oauth-apps');
  });

  it('abre el menú de usuario desde el avatar y muestra el nombre y el workspace', () => {
    auth.me.set({ name: 'Ana', activeWorkspaceId: 'w1', memberships: [{ workspace: { id: 'w1', name: 'Acme' } }] });
    fixture.detectChanges();
    expect(el.querySelector('.user-menu')).toBeNull();
    (el.querySelector('.avatar-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.user-menu .u-who strong')?.textContent).toContain('Ana');
    expect(el.querySelector('.user-menu .u-who small')?.textContent).toContain('Acme');
    // Con una sola membresía no se muestra el selector de workspace.
    expect(el.querySelector('.user-menu select')).toBeNull();
  });

  it('muestra el selector de workspace en el menú de usuario con más de una membresía', () => {
    auth.me.set({
      name: 'Ana',
      activeWorkspaceId: 'w1',
      memberships: [
        { workspace: { id: 'w1', name: 'Acme' } },
        { workspace: { id: 'w2', name: 'Globex' } },
      ],
    });
    fixture.detectChanges();
    (el.querySelector('.avatar-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    const select = el.querySelector('.user-menu select');
    expect(select).not.toBeNull();
    expect(select?.querySelectorAll('option').length).toBe(2);
  });

  it('cierra sesión desde el menú de usuario', () => {
    auth.me.set({ name: 'Ana', activeWorkspaceId: 'w1', memberships: [{ workspace: { id: 'w1', name: 'Acme' } }] });
    fixture.detectChanges();
    (el.querySelector('.avatar-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('.user-menu button[aria-label="Cerrar sesión"]') as HTMLButtonElement).click();
    expect(auth.logout).toHaveBeenCalled();
  });
});
