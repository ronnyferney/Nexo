import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EmptyStateComponent } from './empty-state.component';

describe('EmptyStateComponent', () => {
  let fixture: ComponentFixture<EmptyStateComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EmptyStateComponent] }).compileComponents();
    fixture = TestBed.createComponent(EmptyStateComponent);
    el = fixture.nativeElement as HTMLElement;
  });

  it('muestra título y descripción', () => {
    fixture.componentRef.setInput('title', 'Sin conectores');
    fixture.componentRef.setInput('description', 'Crea tu primer conector.');
    fixture.detectChanges();
    expect(el.querySelector('h3')?.textContent).toContain('Sin conectores');
    expect(el.querySelector('p')?.textContent).toContain('Crea tu primer conector.');
  });

  it('no renderiza acción si no hay actionLabel', () => {
    fixture.componentRef.setInput('title', 'Vacío');
    fixture.detectChanges();
    expect(el.querySelector('button')).toBeNull();
  });

  it('emite action al pulsar el botón', () => {
    fixture.componentRef.setInput('title', 'Vacío');
    fixture.componentRef.setInput('actionLabel', 'Crear');
    let emitted = false;
    fixture.componentInstance.action.subscribe(() => (emitted = true));
    fixture.detectChanges();
    const btn = el.querySelector('button') as HTMLButtonElement;
    expect(btn.textContent).toContain('Crear');
    btn.click();
    expect(emitted).toBeTrue();
  });
});
