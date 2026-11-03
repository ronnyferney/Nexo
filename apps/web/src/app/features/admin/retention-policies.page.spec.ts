import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import type { RetentionPolicy } from '../../core/models';
import { RetentionPoliciesPage } from './retention-policies.page';

function policy(partial: Partial<RetentionPolicy> = {}): RetentionPolicy {
  return {
    id: 'p1',
    workspaceId: 'w1',
    canal: 'CORREO',
    tipoInformacion: 'SENSIBLE',
    retencionDias: 90,
    eliminacionSegura: true,
    consentimientoRequerido: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('RetentionPoliciesPage', () => {
  let fixture: ComponentFixture<RetentionPoliciesPage>;
  let el: HTMLElement;

  async function setup(api: Partial<ApiService>, isAdmin = true) {
    await TestBed.configureTestingModule({
      imports: [RetentionPoliciesPage],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { isAdmin: signal(isAdmin) } },
        { provide: ToastService, useValue: { success: () => {}, error: () => {} } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RetentionPoliciesPage);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('muestra las políticas cuando hay datos', async () => {
    await setup({ retentionPolicies: () => Promise.resolve([policy()]) });
    const texto = el.textContent ?? '';
    expect(texto).toContain('Correo');
    expect(texto).toContain('Sensible');
    expect(texto).toContain('90 días');
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('muestra el estado vacío cuando no hay políticas', async () => {
    await setup({ retentionPolicies: () => Promise.resolve([]) });
    expect(el.textContent ?? '').toContain('No hay políticas diferenciadas');
  });

  it('muestra el estado de error ante un fallo de carga', async () => {
    await setup({
      retentionPolicies: () => Promise.reject(new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
    });
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(el.textContent ?? '').toContain('No se pudieron cargar las políticas');
  });

  it('oculta las acciones de edición sin rol de administración', async () => {
    await setup({ retentionPolicies: () => Promise.resolve([policy()]) }, false);
    const botones = Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
    expect(botones.some((t) => t.includes('Nueva política'))).toBeFalse();
    expect(botones.some((t) => t.includes('Editar'))).toBeFalse();
  });

  it('muestra las acciones de edición con rol de administración', async () => {
    await setup({ retentionPolicies: () => Promise.resolve([policy()]) }, true);
    const botones = Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
    expect(botones.some((t) => t.includes('Nueva política'))).toBeTrue();
  });
});
