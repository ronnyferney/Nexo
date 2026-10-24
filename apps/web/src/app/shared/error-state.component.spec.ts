import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ErrorStateComponent } from './error-state.component';

describe('ErrorStateComponent', () => {
  let fixture: ComponentFixture<ErrorStateComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ErrorStateComponent] }).compileComponents();
    fixture = TestBed.createComponent(ErrorStateComponent);
    el = fixture.nativeElement as HTMLElement;
  });

  it('es accesible: role=alert y muestra el mensaje', () => {
    fixture.componentRef.setInput('message', 'Falló la carga.');
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(el.textContent).toContain('Falló la carga.');
  });

  it('muestra el botón Reintentar y emite retry', () => {
    fixture.componentRef.setInput('message', 'Error');
    let emitted = false;
    fixture.componentInstance.retry.subscribe(() => (emitted = true));
    fixture.detectChanges();
    const btn = el.querySelector('button') as HTMLButtonElement;
    expect(btn.textContent).toContain('Reintentar');
    btn.click();
    expect(emitted).toBeTrue();
  });

  it('oculta el botón cuando retryable es false', () => {
    fixture.componentRef.setInput('message', 'Error');
    fixture.componentRef.setInput('retryable', false);
    fixture.detectChanges();
    expect(el.querySelector('button')).toBeNull();
  });
});
