import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../../../core/api.service';
import { ToastService } from '../../../core/toast.service';
import type { PilotConfig } from '../../../core/models';
import { PilotToggleComponent } from './pilot-toggle.component';

describe('PilotToggleComponent', () => {
  let fixture: ComponentFixture<PilotToggleComponent>;
  let el: HTMLElement;

  async function setup(api: Partial<ApiService>, canEdit = true) {
    await TestBed.configureTestingModule({
      imports: [PilotToggleComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: { success: () => {}, error: () => {} } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PilotToggleComponent);
    fixture.componentRef.setInput('canEdit', canEdit);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const pilot = (modoPiloto: boolean): PilotConfig => ({ modoPiloto, desde: modoPiloto ? '2026-01-01T00:00:00.000Z' : null });

  it('muestra el estado inactivo y el aviso del proveedor simulado', async () => {
    await setup({ pilot: () => Promise.resolve(pilot(false)) });
    expect(el.textContent ?? '').toContain('Inactivo');
    expect(el.textContent ?? '').toContain('simulado (mock)');
  });

  it('muestra el estado de error ante un fallo de carga', async () => {
    await setup({ pilot: () => Promise.reject(new HttpErrorResponse({ status: 500, statusText: 'x' })) });
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('oculta el botón de activar sin permiso de edición', async () => {
    await setup({ pilot: () => Promise.resolve(pilot(false)) }, false);
    const botones = Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
    expect(botones.some((t) => t.includes('Activar'))).toBeFalse();
  });

  it('muestra el botón de activar con permiso de edición', async () => {
    await setup({ pilot: () => Promise.resolve(pilot(false)) }, true);
    const botones = Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
    expect(botones.some((t) => t.includes('Activar'))).toBeTrue();
  });
});
