import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BreadcrumbsComponent } from './breadcrumbs.component';

describe('BreadcrumbsComponent', () => {
  let fixture: ComponentFixture<BreadcrumbsComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BreadcrumbsComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(BreadcrumbsComponent);
    el = fixture.nativeElement as HTMLElement;
  });

  it('no renderiza nada sin ítems', () => {
    fixture.detectChanges();
    expect(el.querySelector('nav')).toBeNull();
  });

  it('renderiza un landmark de navegación accesible con cada miga', () => {
    fixture.componentRef.setInput('items', [{ label: 'Portal', link: '/' }, { label: 'Agentes', link: '/agents' }, { label: 'Ventas' }]);
    fixture.detectChanges();
    const nav = el.querySelector('nav');
    expect(nav?.getAttribute('aria-label')).toBe('Migas de pan');
    expect(el.querySelectorAll('li').length).toBe(3);
  });

  it('enlaza las migas intermedias con link y deja la última como texto con aria-current', () => {
    fixture.componentRef.setInput('items', [{ label: 'Portal', link: '/' }, { label: 'Ventas', link: '/agents/1' }]);
    fixture.detectChanges();
    const links = el.querySelectorAll('a');
    expect(links.length).toBe(1);
    expect(links[0].textContent).toContain('Portal');
    const current = el.querySelector('[aria-current="page"]');
    expect(current?.textContent).toContain('Ventas');
    // La última miga no es un enlace aunque traiga link.
    expect(current?.tagName.toLowerCase()).toBe('span');
  });

  it('acepta una etiqueta accesible personalizada', () => {
    fixture.componentRef.setInput('items', [{ label: 'Inicio' }]);
    fixture.componentRef.setInput('ariaLabel', 'Ruta actual');
    fixture.detectChanges();
    expect(el.querySelector('nav')?.getAttribute('aria-label')).toBe('Ruta actual');
  });
});
