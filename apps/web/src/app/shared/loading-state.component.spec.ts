import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoadingStateComponent } from './loading-state.component';

describe('LoadingStateComponent', () => {
  let fixture: ComponentFixture<LoadingStateComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [LoadingStateComponent] }).compileComponents();
    fixture = TestBed.createComponent(LoadingStateComponent);
    el = fixture.nativeElement as HTMLElement;
  });

  it('es accesible: role=status y aria-busy', () => {
    fixture.detectChanges();
    const box = el.querySelector('[role="status"]');
    expect(box).not.toBeNull();
    expect(box?.getAttribute('aria-busy')).toBe('true');
  });

  it('muestra el texto por defecto y uno personalizado', () => {
    fixture.detectChanges();
    expect(el.textContent).toContain('Cargando…');
    fixture.componentRef.setInput('text', 'Cargando conectores…');
    fixture.detectChanges();
    expect(el.textContent).toContain('Cargando conectores…');
  });

  it('aplica la clase de tamaño al spinner', () => {
    fixture.componentRef.setInput('size', 'lg');
    fixture.detectChanges();
    expect(el.querySelector('.spinner')?.classList).toContain('lg');
  });
});
