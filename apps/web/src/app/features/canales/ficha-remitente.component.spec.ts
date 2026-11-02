import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import type { ContactoPerfil, OrganizacionPerfil } from '../../core/models';
import { FichaRemitenteComponent } from './ficha-remitente.component';

function organizacion(partial: Partial<OrganizacionPerfil> = {}): OrganizacionPerfil {
  return {
    id: 'o1',
    workspaceId: 'w1',
    nombre: 'Acme',
    dominio: 'acme.com',
    tipoSector: 'Industria',
    notas: null,
    fuente: 'correo',
    contactos: [
      { id: 'c1' } as ContactoPerfil,
      { id: 'c2' } as ContactoPerfil,
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

function contacto(partial: Partial<ContactoPerfil> = {}): ContactoPerfil {
  return {
    id: 'c1',
    workspaceId: 'w1',
    nombre: 'Ana Pérez',
    correoPrincipal: 'ana@acme.com',
    correos: ['ana@acme.com'],
    telefonos: null,
    idioma: 'es',
    tono: 'cercano',
    organizacionId: 'o1',
    organizacion: organizacion(),
    senales: ['paga a tiempo'],
    fuente: 'correo',
    ultimaInteraccionEn: '2026-10-01T00:00:00.000Z',
    interaccionesCount: 7,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

const notFound = () => new HttpErrorResponse({ status: 404, statusText: 'Not Found' });

describe('FichaRemitenteComponent', () => {
  let fixture: ComponentFixture<FichaRemitenteComponent>;
  let el: HTMLElement;

  async function setup(api: Partial<ApiService>, correo = 'ana@acme.com', canEdit = false) {
    const toastMock: Partial<ToastService> = { success: () => {}, error: () => {} };
    await TestBed.configureTestingModule({
      imports: [FichaRemitenteComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toastMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FichaRemitenteComponent);
    fixture.componentRef.setInput('correo', correo);
    fixture.componentRef.setInput('canEdit', canEdit);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('muestra persona y organización cuando hay perfil', async () => {
    await setup({
      contactoPorCorreo: () => Promise.resolve(contacto()),
      organizacionPorDominio: () => Promise.resolve(organizacion()),
    });
    const texto = el.textContent ?? '';
    expect(texto).toContain('Ana Pérez');
    expect(texto).toContain('cercano');
    expect(texto).toContain('paga a tiempo');
    expect(texto).toContain('Acme');
    // Nº de contactos de la organización (2) y nº de interacciones (7).
    expect(texto).toContain('2');
    expect(texto).toContain('7');
    // No hay estado de error ni acciones de registro (ya hay perfil).
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('muestra estado vacío y ofrece registrar cuando no hay perfil (con permiso de edición)', async () => {
    await setup(
      {
        contactoPorCorreo: () => Promise.reject(notFound()),
        organizacionPorDominio: () => Promise.reject(notFound()),
      },
      'nadie@desconocida.com',
      true,
    );
    const texto = el.textContent ?? '';
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(texto).toContain('Aún no hay perfil de esta persona.');
    const botones = Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
    expect(botones.some((t) => t.includes('Registrar contacto'))).toBeTrue();
    expect(botones.some((t) => t.includes('Registrar organización'))).toBeTrue();
  });

  it('oculta las acciones de registro sin permiso de edición', async () => {
    await setup(
      {
        contactoPorCorreo: () => Promise.reject(notFound()),
        organizacionPorDominio: () => Promise.reject(notFound()),
      },
      'nadie@desconocida.com',
      false,
    );
    const botones = Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
    expect(botones.some((t) => t.includes('Registrar'))).toBeFalse();
  });

  it('muestra estado de error ante un fallo que no es 404', async () => {
    await setup({
      contactoPorCorreo: () => Promise.reject(new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
      organizacionPorDominio: () => Promise.resolve(organizacion()),
    });
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    // En error no se pintan los bloques de persona/organización.
    expect(el.textContent ?? '').not.toContain('Ana Pérez');
  });

  it('recae en la organización vinculada al contacto si no se resuelve por dominio', async () => {
    await setup({
      contactoPorCorreo: () => Promise.resolve(contacto()),
      organizacionPorDominio: () => Promise.reject(notFound()),
    });
    // La organización vinculada al contacto (Acme) se muestra aunque el dominio no resuelva.
    expect(el.textContent ?? '').toContain('Acme');
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });
});
