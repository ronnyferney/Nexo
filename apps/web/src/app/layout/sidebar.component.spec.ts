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

describe('SidebarComponent (dos niveles: riel + panel contextual)', () => {
  let fixture: ComponentFixture<SidebarComponent>;
  let el: HTMLElement;
  let auth: ReturnType<typeof makeAuth>;
  let platform: { isPlatformAdmin: ReturnType<typeof signal<boolean>> };

  const mainAreas = () => el.querySelectorAll<HTMLButtonElement>('.rail .rail-ico.area');
  const footAreas = () => el.querySelectorAll<HTMLButtonElement>('.rail .rail-ico.foot');
  const panelLinks = () => el.querySelectorAll<HTMLAnchorElement>('.panel a.nav-link');
  const panelPaths = () => [...panelLinks()].map((a) => a.getAttribute('href') ?? '');
  const search = (text: string) => {
    const input = el.querySelector('.filter input') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const openUser = () => {
    (el.querySelector('.rail-user') as HTMLButtonElement).click();
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

  it('un VIEWER ve 6 áreas principales y 2 utilidades en el riel; ninguna ruta de admin/plataforma en el panel', () => {
    // home, work, agents, comms, governance, finance (org admin oculta).
    expect(mainAreas().length).toBe(6);
    // utilidades: Conecta tus apps + Ajustes (Conecta tu IA es admin).
    expect(footAreas().length).toBe(2);
    search('políticas');
    expect(panelPaths().some((p) => p.startsWith('/admin'))).toBeFalse();
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
    (el.querySelector('.rail-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.panel')).toBeNull();
    expect(el.querySelector('.nav.panel-hidden')).not.toBeNull();
  });

  it('un admin ve 7 áreas principales (incluye Organización) y 3 utilidades', () => {
    auth.isAdmin.set(true);
    fixture.detectChanges();
    expect(mainAreas().length).toBe(7);
    expect(footAreas().length).toBe(3);
    search('políticas');
    expect(panelPaths()).toContain('/admin/politicas');
  });

  it('el menú de usuario muestra nombre y correo, y las organizaciones como opciones', () => {
    auth.me.set({
      name: 'Ana Pérez',
      email: 'ana@acme.co',
      activeWorkspaceId: 'w1',
      memberships: [{ workspace: { id: 'w1', name: 'Acme' } }],
    });
    fixture.detectChanges();
    expect(el.querySelector('.user-menu')).toBeNull();
    openUser();
    expect(el.querySelector('.user-menu .u-head strong')?.textContent).toContain('Ana Pérez');
    expect(el.querySelector('.user-menu .u-head small')?.textContent).toContain('ana@acme.co');
    // La organización activa aparece marcada (aria-checked).
    const org = el.querySelector('.user-menu [role="menuitemradio"]');
    expect(org?.getAttribute('aria-checked')).toBe('true');
  });

  it('lista todas las organizaciones (workspaces) con más de una membresía', () => {
    auth.me.set({
      name: 'Ana',
      email: 'ana@acme.co',
      activeWorkspaceId: 'w1',
      memberships: [
        { workspace: { id: 'w1', name: 'Acme' } },
        { workspace: { id: 'w2', name: 'Globex' } },
      ],
    });
    fixture.detectChanges();
    openUser();
    expect(el.querySelectorAll('.user-menu [role="menuitemradio"]').length).toBe(2);
  });

  it('cierra sesión desde el menú de usuario', () => {
    auth.me.set({ name: 'Ana', email: 'ana@acme.co', activeWorkspaceId: 'w1', memberships: [{ workspace: { id: 'w1', name: 'Acme' } }] });
    fixture.detectChanges();
    openUser();
    (el.querySelector('.user-menu button[aria-label="Cerrar sesión"]') as HTMLButtonElement).click();
    expect(auth.logout).toHaveBeenCalled();
  });
});
