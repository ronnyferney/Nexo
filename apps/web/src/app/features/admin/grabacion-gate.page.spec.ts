import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import type { GrabacionConfig, OrgUnit } from '../../core/models';
import { GrabacionGatePage } from './grabacion-gate.page';

function empresa(partial: Partial<OrgUnit> = {}): OrgUnit {
  return {
    id: 'e1',
    name: 'Acme S.A.',
    code: null,
    parentId: null,
    allowedModels: [],
    memberCount: 0,
    isRoot: true,
    tipo: 'EMPRESA',
    empresaId: null,
    responsableUserId: null,
    estado: 'ACTIVA',
    vigenteDesde: null,
    vigenteHasta: null,
    ...partial,
  };
}

function config(partial: Partial<GrabacionConfig> = {}): GrabacionConfig {
  return {
    id: 'g1',
    workspaceId: 'w1',
    empresaId: 'e1',
    grabarAudio: false,
    guardarTranscripcion: false,
    guardarResumen: false,
    guardarEvidencia: false,
    grabacionAutorizadaJuridicamente: false,
    requiereAutorizacion: true,
    finalidad: null,
    retencionDias: null,
    accesoRoles: [],
    eliminacionAutomatica: false,
    configurado: true,
    ...partial,
  };
}

describe('GrabacionGatePage', () => {
  let fixture: ComponentFixture<GrabacionGatePage>;
  let el: HTMLElement;

  async function setup(api: Partial<ApiService>, isAdmin = true) {
    await TestBed.configureTestingModule({
      imports: [GrabacionGatePage],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { isAdmin: signal(isAdmin) } },
        { provide: ToastService, useValue: { success: () => {}, error: () => {} } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(GrabacionGatePage);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('muestra el aviso de que la grabación está OFF hasta la validación jurídica', async () => {
    await setup({ adminOrgUnits: () => Promise.resolve([empresa()]) });
    expect(el.textContent ?? '').toContain('OFF hasta la validación jurídica');
  });

  it('lista solo las empresas de la estructura', async () => {
    await setup({
      adminOrgUnits: () =>
        Promise.resolve([empresa(), empresa({ id: 'u2', name: 'Área X', tipo: 'AREA_FUNCIONAL', isRoot: false })]),
    });
    const options = Array.from(el.querySelectorAll('#g-empresa option')).map((o) => o.textContent?.trim() ?? '');
    expect(options).toContain('Acme S.A.');
    expect(options).not.toContain('Área X');
  });

  it('muestra el estado vacío cuando no hay empresas', async () => {
    await setup({ adminOrgUnits: () => Promise.resolve([]) });
    expect(el.textContent ?? '').toContain('No hay empresas');
  });

  it('muestra el estado de error ante un fallo de carga', async () => {
    await setup({
      adminOrgUnits: () => Promise.reject(new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
    });
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('al elegir una empresa muestra el gate y permite autorizar con rol de administración', async () => {
    await setup(
      { adminOrgUnits: () => Promise.resolve([empresa()]), grabacionConfig: () => Promise.resolve(config()) },
      true,
    );
    fixture.componentInstance.selectEmpresa('e1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const botones = Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
    expect(botones.some((t) => t.includes('Autorizar jurídicamente'))).toBeTrue();
  });

  it('oculta la acción de autorizar sin rol de administración', async () => {
    await setup(
      { adminOrgUnits: () => Promise.resolve([empresa()]), grabacionConfig: () => Promise.resolve(config()) },
      false,
    );
    fixture.componentInstance.selectEmpresa('e1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const botones = Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
    expect(botones.some((t) => t.includes('Autorizar jurídicamente'))).toBeFalse();
    expect(el.textContent ?? '').toContain('Solo un administrador');
  });
});
