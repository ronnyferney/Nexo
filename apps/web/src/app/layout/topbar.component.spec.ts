import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { PlatformApi } from '../core/platform.api';
import { TopbarComponent } from './topbar.component';

function makeAuth() {
  return {
    me: signal<any>(null),
    isAdmin: signal(false),
    logout: jasmine.createSpy('logout'),
    switchWorkspace: jasmine.createSpy('switchWorkspace').and.resolveTo(undefined),
  };
}

describe('TopbarComponent (toolbar superior)', () => {
  let fixture: ComponentFixture<TopbarComponent>;
  let el: HTMLElement;
  let auth: ReturnType<typeof makeAuth>;

  const openUser = () => {
    (el.querySelector('.t-user') as HTMLButtonElement).click();
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
      imports: [TopbarComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: PlatformApi, useValue: { isPlatformAdmin: signal(false) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TopbarComponent);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('muestra el título de la sección activa y el buscador accesible', () => {
    expect(el.querySelector('.t-title')?.textContent).toContain('Inicio');
    expect(el.querySelector('.t-search input')?.getAttribute('aria-label')).toBe('Buscar en Nexo');
  });

  it('no duplica el botón de colapsar: ese control vive en el menú lateral', () => {
    expect(el.querySelector('.t-toggle')).toBeNull();
  });

  it('el menú de usuario muestra nombre, correo y la organización activa marcada', () => {
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
    const org = el.querySelector('.user-menu [role="menuitemradio"]');
    expect(org?.getAttribute('aria-checked')).toBe('true');
  });

  it('lista todas las organizaciones con más de una membresía', () => {
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
