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

  beforeEach(async () => {
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

  it('renderiza la marca y la navegación principal accesible', () => {
    expect(el.querySelector('.brand')?.getAttribute('aria-label')).toContain('Nexo');
    expect(el.querySelector('nav')?.getAttribute('aria-label')).toBe('Navegación principal');
    // Los 20 ítems del portal están siempre presentes.
    const portalLinks = el.querySelectorAll('[aria-labelledby="nav-portal"] a');
    expect(portalLinks.length).toBe(20);
  });

  it('oculta las secciones de administración y plataforma sin los roles correspondientes', () => {
    expect(el.querySelector('[aria-labelledby="nav-admin"]')).toBeNull();
    expect(el.querySelector('[aria-labelledby="nav-platform"]')).toBeNull();
  });

  it('muestra la sección de administración cuando el usuario es admin', () => {
    auth.isAdmin.set(true);
    fixture.detectChanges();
    expect(el.querySelector('[aria-labelledby="nav-admin"]')).not.toBeNull();
  });

  it('muestra la sección de plataforma cuando es admin de plataforma', () => {
    platform.isPlatformAdmin.set(true);
    fixture.detectChanges();
    expect(el.querySelector('[aria-labelledby="nav-platform"]')).not.toBeNull();
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
