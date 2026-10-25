import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PageHeaderComponent } from './page-header.component';

@Component({
  standalone: true,
  imports: [PageHeaderComponent],
  template: `
    <nx-page-header [heading]="heading" [description]="description" [crumbs]="crumbs" [hostClass]="hostClass">
      <button lead class="back">Volver</button>
      <span meta class="badge">meta</span>
      <button actions class="btn primary">Nuevo</button>
    </nx-page-header>
  `,
})
class HostComponent {
  heading = 'Skills';
  description = 'Habilidades reutilizables';
  crumbs: { label: string; link?: string }[] = [];
  hostClass = '';
}

describe('PageHeaderComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('muestra el título y la descripción', () => {
    expect(el.querySelector('h1')?.textContent).toContain('Skills');
    expect(el.querySelector('.page-header p')?.textContent).toContain('Habilidades reutilizables');
  });

  it('no renderiza descripción si está vacía', () => {
    fixture.componentInstance.description = '';
    fixture.detectChanges();
    expect(el.querySelector('.page-header p')).toBeNull();
  });

  it('proyecta los slots lead, meta y actions', () => {
    expect(el.querySelector('.ph-title .back')?.textContent).toContain('Volver');
    expect(el.querySelector('.ph-text .badge')?.textContent).toContain('meta');
    expect(el.querySelector('.ph-actions .btn')?.textContent).toContain('Nuevo');
  });

  it('proyecta una descripción con markup por el slot meta', () => {
    // El slot meta permite descripciones ricas (no solo string) bajo el título.
    expect(el.querySelector('.ph-text .badge')?.textContent).toContain('meta');
  });

  it('usa solo la clase base .page-header cuando no hay hostClass', () => {
    const header = el.querySelector('header')!;
    expect(header.classList.contains('page-header')).toBe(true);
    expect(header.className.trim()).toBe('page-header');
  });

  it('añade las variantes de hostClass sin perder la clase base', () => {
    fixture.componentInstance.hostClass = 'brand-hero';
    fixture.detectChanges();
    const header = el.querySelector('header')!;
    expect(header.classList.contains('page-header')).toBe(true);
    expect(header.classList.contains('brand-hero')).toBe(true);

    fixture.componentInstance.hostClass = 'in-card';
    fixture.detectChanges();
    expect(header.classList.contains('page-header')).toBe(true);
    expect(header.classList.contains('in-card')).toBe(true);
    expect(header.classList.contains('brand-hero')).toBe(false);
  });

  it('muestra migas solo cuando hay ítems', () => {
    expect(el.querySelector('nx-breadcrumbs nav')).toBeNull();
    fixture.componentInstance.crumbs = [{ label: 'Portal', link: '/' }, { label: 'Skills' }];
    fixture.detectChanges();
    expect(el.querySelector('nx-breadcrumbs nav')).not.toBeNull();
    expect(el.querySelectorAll('nx-breadcrumbs li').length).toBe(2);
  });
});
