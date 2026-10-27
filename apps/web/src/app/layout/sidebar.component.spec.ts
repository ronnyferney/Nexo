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

describe('SidebarComponent (menú único segmentado con pie)', () => {
  let fixture: ComponentFixture<SidebarComponent>;
  let el: HTMLElement;
  let auth: ReturnType<typeof makeAuth>;
  let platform: { isPlatformAdmin: ReturnType<typeof signal<boolean>> };

  const links = () => el.querySelectorAll<HTMLAnchorElement>('a.nav-link');
  const paths = () => [...links()].map((a) => a.getAttribute('href') ?? '');
  const sections = () => el.querySelectorAll<HTMLElement>('.main p.section');
  const footerPaths = () => [...el.querySelectorAll<HTMLAnchorElement>('.footer-nav a.nav-link')].map((a) => a.getAttribute('href') ?? '');
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

  it('renderiza la marca, el filtro y la navegación principal accesibles', () => {
    expect(el.querySelector('.brand')?.getAttribute('aria-label')).toContain('Nexo');
    expect(el.querySelector('.main')?.getAttribute('aria-label')).toBe('Navegación principal');
    expect(el.querySelector('.filter input')?.getAttribute('aria-label')).toBe('Buscar en el menú');
  });

  it('un VIEWER ve los 24 enlaces comunes y ninguna ruta de admin/plataforma', () => {
    expect(links().length).toBe(24);
    expect(paths().some((p) => p.startsWith('/admin'))).toBeFalse();
    expect(paths().some((p) => p.startsWith('/platform'))).toBeFalse();
  });

  it('segmenta en secciones operativas y ancla las utilidades al pie (Integraciones)', () => {
    const labels = [...sections()].map((p) => p.textContent?.trim());
    expect(labels).toContain('Agentes');
    // work, agents, comms, governance, finance (home fijada; org/settings/plataforma ocultas al VIEWER).
    expect(sections().length).toBe(5);
    // El pie muestra Integraciones (apps conectadas + conectores) para el VIEWER.
    expect(footerPaths()).toEqual(['/integrations', '/connectors']);
  });

  it('pliega a solo iconos: oculta filtro, etiquetas y textos; mantiene los enlaces', () => {
    const toggle = el.querySelector('.collapse') as HTMLButtonElement;
    expect(el.querySelector('.sb.rail')).toBeNull();
    toggle.click();
    fixture.detectChanges();
    expect(el.querySelector('.sb.rail')).not.toBeNull();
    expect(el.querySelector('.filter')).toBeNull();
    expect(sections().length).toBe(0);
    expect(el.querySelector('a.nav-link .lbl')).toBeNull();
    expect(links().length).toBe(24);
  });

  it('marca el ítem activo según la ruta con aria-current (ruta inicial «/»)', () => {
    const active = el.querySelector('a.nav-link.active');
    expect(active?.getAttribute('aria-current')).toBe('page');
    expect(active?.getAttribute('href')).toBe('/');
  });

  it('filtra en todo el menú y muestra el estado vacío sin coincidencias', () => {
    search('skills');
    expect(paths()).toEqual(['/skills']);
    search('xyz-no-existe');
    expect(links().length).toBe(0);
    expect(el.querySelector('.main .empty')).not.toBeNull();
  });

  it('muestra rutas de administración y el pie de Ajustes cuando el usuario es admin', () => {
    auth.isAdmin.set(true);
    fixture.detectChanges();
    expect(paths()).toContain('/admin/politicas');
    expect(footerPaths()).toContain('/admin/settings');
    expect(paths().some((p) => p.startsWith('/platform'))).toBeFalse();
  });

  it('muestra rutas de plataforma (en el pie) cuando es admin de plataforma', () => {
    platform.isPlatformAdmin.set(true);
    fixture.detectChanges();
    expect(footerPaths()).toContain('/platform');
    expect(footerPaths()).toContain('/platform/oauth-apps');
  });

  it('abre el menú de usuario desde el conmutador superior y muestra nombre/workspace', () => {
    auth.me.set({ name: 'Ana', activeWorkspaceId: 'w1', memberships: [{ workspace: { id: 'w1', name: 'Acme' } }] });
    fixture.detectChanges();
    expect(el.querySelector('.user-menu')).toBeNull();
    (el.querySelector('.user-switch') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.user-menu .u-who strong')?.textContent).toContain('Ana');
    expect(el.querySelector('.user-menu .u-who small')?.textContent).toContain('Acme');
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
    (el.querySelector('.user-switch') as HTMLButtonElement).click();
    fixture.detectChanges();
    const select = el.querySelector('.user-menu select');
    expect(select).not.toBeNull();
    expect(select?.querySelectorAll('option').length).toBe(2);
  });

  it('cierra sesión desde el menú de usuario', () => {
    auth.me.set({ name: 'Ana', activeWorkspaceId: 'w1', memberships: [{ workspace: { id: 'w1', name: 'Acme' } }] });
    fixture.detectChanges();
    (el.querySelector('.user-switch') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('.user-menu button[aria-label="Cerrar sesión"]') as HTMLButtonElement).click();
    expect(auth.logout).toHaveBeenCalled();
  });
});
