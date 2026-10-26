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

describe('SidebarComponent', () => {
  let fixture: ComponentFixture<SidebarComponent>;
  let el: HTMLElement;
  let auth: ReturnType<typeof makeAuth>;
  let platform: { isPlatformAdmin: ReturnType<typeof signal<boolean>> };

  const links = () => el.querySelectorAll<HTMLAnchorElement>('nav a.nav-link');
  const groupHeads = () => el.querySelectorAll<HTMLButtonElement>('nav button.group-head');
  const headByLabel = (label: string) =>
    [...groupHeads()].find((b) => b.querySelector('.g-label')?.textContent?.trim() === label)!;

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

  it('renderiza la marca, el filtro y la navegación principal accesible', () => {
    expect(el.querySelector('.brand')?.getAttribute('aria-label')).toContain('Nexo');
    expect(el.querySelector('nav')?.getAttribute('aria-label')).toBe('Navegación principal');
    expect(el.querySelector('.filter input')?.getAttribute('aria-label')).toBe('Buscar en el menú');
  });

  it('un VIEWER solo ve los 23 enlaces comunes y ninguna ruta de admin/plataforma', () => {
    expect(links().length).toBe(23);
    const paths = [...links()].map((a) => a.getAttribute('href') ?? '');
    expect(paths.some((p) => p.startsWith('/admin'))).toBeFalse();
    expect(paths.some((p) => p.startsWith('/platform'))).toBeFalse();
  });

  it('presenta las secciones como encabezados colapsables accesibles', () => {
    const heads = groupHeads();
    // work, agents, comms, org, governance, finance (home está fijada; admin/plataforma ocultas al VIEWER).
    expect(heads.length).toBe(6);
    for (const h of heads) {
      expect(h.getAttribute('aria-expanded')).toBeTruthy();
      expect(h.getAttribute('aria-controls')).toBeTruthy();
    }
  });

  it('pliega y despliega una sección al pulsar su encabezado', () => {
    const head = headByLabel('Agentes');
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('#grp-items-agents')).not.toBeNull();
    head.click();
    fixture.detectChanges();
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('#grp-items-agents')).toBeNull();
  });

  it('marca el ítem activo según la ruta con aria-current', () => {
    // La ruta inicial del router de pruebas es «/»: se activa «Inicio».
    const active = el.querySelector('a.nav-link.active');
    expect(active?.getAttribute('aria-current')).toBe('page');
    expect(active?.getAttribute('href')).toBe('/');
  });

  it('filtra los ítems por texto y muestra el estado vacío sin coincidencias', () => {
    const input = el.querySelector('.filter input') as HTMLInputElement;
    input.value = 'skills';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const paths = [...links()].map((a) => a.getAttribute('href'));
    expect(paths).toEqual(['/skills']);

    input.value = 'xyz-no-existe';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(links().length).toBe(0);
    expect(el.querySelector('nav .empty')).not.toBeNull();
  });

  it('muestra los enlaces de administración cuando el usuario es admin', () => {
    auth.isAdmin.set(true);
    fixture.detectChanges();
    expect(headByLabel('Administración')).toBeDefined();
    const paths = [...links()].map((a) => a.getAttribute('href') ?? '');
    expect(paths).toContain('/admin/politicas');
    expect(paths.some((p) => p.startsWith('/platform'))).toBeFalse();
  });

  it('muestra la sección de plataforma cuando es admin de plataforma', () => {
    platform.isPlatformAdmin.set(true);
    fixture.detectChanges();
    const paths = [...links()].map((a) => a.getAttribute('href') ?? '');
    expect(paths).toContain('/platform');
    expect(paths).toContain('/platform/oauth-apps');
  });

  it('muestra el bloque de usuario y el nombre del workspace activo', () => {
    auth.me.set({
      name: 'Ana',
      activeWorkspaceId: 'w1',
      memberships: [{ workspace: { id: 'w1', name: 'Acme' } }],
    });
    fixture.detectChanges();
    expect(el.querySelector('.user .who strong')?.textContent).toContain('Ana');
    expect(el.querySelector('.user .who small')?.textContent).toContain('Acme');
    // Con una sola membresía no se muestra el selector de workspace.
    expect(el.querySelector('select.ws')).toBeNull();
  });

  it('muestra el selector de workspace con más de una membresía', () => {
    auth.me.set({
      name: 'Ana',
      activeWorkspaceId: 'w1',
      memberships: [
        { workspace: { id: 'w1', name: 'Acme' } },
        { workspace: { id: 'w2', name: 'Globex' } },
      ],
    });
    fixture.detectChanges();
    const select = el.querySelector('select.ws');
    expect(select).not.toBeNull();
    expect(select?.querySelectorAll('option').length).toBe(2);
  });

  it('cierra sesión al pulsar el botón correspondiente', () => {
    auth.me.set({ name: 'Ana', activeWorkspaceId: 'w1', memberships: [{ workspace: { id: 'w1', name: 'Acme' } }] });
    fixture.detectChanges();
    const logoutBtn = el.querySelector('button[aria-label="Cerrar sesión"]') as HTMLButtonElement;
    logoutBtn.click();
    expect(auth.logout).toHaveBeenCalled();
  });
});
