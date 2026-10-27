import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ExecutionParamsApi } from '../../core/execution-params.api';
import type { ParametrosEjecucion, SetParametrosEjecucion } from '../../core/execution-params.models';
import { ToastService } from '../../core/toast.service';
import { AgentExecutionParamsComponent } from './agent-execution-params.component';

function parametros(partial: Partial<ParametrosEjecucion> = {}): ParametrosEjecucion {
  return {
    agentId: 'a1',
    estacionVirtualId: null,
    navegacionWeb: false,
    sistemasAutorizados: false,
    salidaInternet: false,
    parametrosEjecucion: {},
    ...partial,
  };
}

describe('AgentExecutionParamsComponent', () => {
  let fixture: ComponentFixture<AgentExecutionParamsComponent>;
  let el: HTMLElement;
  let guardarSpy: jasmine.Spy<(id: string, data: SetParametrosEjecucion) => Promise<ParametrosEjecucion>>;
  let saved: ParametrosEjecucion;

  async function setup(initial: ParametrosEjecucion = parametros()) {
    saved = initial;
    guardarSpy = jasmine
      .createSpy('guardarParametros')
      .and.callFake((_id: string, data: SetParametrosEjecucion) => {
        saved = parametros({ ...saved, ...data });
        return Promise.resolve(saved);
      });
    const apiMock: Partial<ExecutionParamsApi> = {
      parametros: () => Promise.resolve(initial),
      estaciones: () => Promise.resolve([]),
      guardarParametros: guardarSpy as unknown as ExecutionParamsApi['guardarParametros'],
    };
    const toastMock: Partial<ToastService> = { success: () => {}, error: () => {} };

    await TestBed.configureTestingModule({
      imports: [AgentExecutionParamsComponent],
      providers: [
        provideRouter([]),
        { provide: ExecutionParamsApi, useValue: apiMock },
        { provide: ToastService, useValue: toastMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentExecutionParamsComponent);
    fixture.componentRef.setInput('agentId', 'a1');
    fixture.componentRef.setInput('canEdit', true);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('muestra dos interruptores independientes y arranca sin cambios pendientes', async () => {
    await setup();
    const switches = el.querySelectorAll('input[type="checkbox"][role="switch"]');
    expect(switches.length).toBe(2);
    expect(fixture.componentInstance.dirty()).toBeFalse();
  });

  it('marca dirty al cambiar la navegación web y lo limpia al guardar', async () => {
    await setup();
    const c = fixture.componentInstance;
    expect(c.dirty()).toBeFalse();
    c.navegacionWeb.set(true);
    expect(c.dirty()).toBeTrue();
    await c.save();
    fixture.detectChanges();
    expect(c.dirty()).toBeFalse();
    expect(guardarSpy).toHaveBeenCalledWith('a1', jasmine.objectContaining({ navegacionWeb: true, sistemasAutorizados: false }));
  });

  it('marca dirty al cambiar la conexión a sistemas autorizados', async () => {
    await setup();
    const c = fixture.componentInstance;
    expect(c.dirty()).toBeFalse();
    c.sistemasAutorizados.set(true);
    expect(c.dirty()).toBeTrue();
    await c.save();
    expect(guardarSpy).toHaveBeenCalledWith('a1', jasmine.objectContaining({ navegacionWeb: false, sistemasAutorizados: true }));
  });

  it('refleja los dos valores que llegan del GET y no envía el campo legado salidaInternet', async () => {
    await setup(parametros({ navegacionWeb: true, sistemasAutorizados: false, salidaInternet: true }));
    const c = fixture.componentInstance;
    expect(c.navegacionWeb()).toBeTrue();
    expect(c.sistemasAutorizados()).toBeFalse();
    c.sistemasAutorizados.set(true);
    await c.save();
    const [, data] = guardarSpy.calls.mostRecent().args;
    expect(data.salidaInternet).toBeUndefined();
    expect(data.navegacionWeb).toBeTrue();
    expect(data.sistemasAutorizados).toBeTrue();
  });
});
