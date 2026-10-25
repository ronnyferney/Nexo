import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PageHeaderComponent } from './page-header.component';

@Component({
  standalone: true,
  imports: [PageHeaderComponent],
  template: `
    <nx-page-header [heading]="heading" [description]="description" [crumbs]="crumbs">
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

  it('muestra migas solo cuando hay ítems', () => {
    expect(el.querySelector('nx-breadcrumbs nav')).toBeNull();
    fixture.componentInstance.crumbs = [{ label: 'Portal', link: '/' }, { label: 'Skills' }];
    fixture.detectChanges();
    expect(el.querySelector('nx-breadcrumbs nav')).not.toBeNull();
    expect(el.querySelectorAll('nx-breadcrumbs li').length).toBe(2);
  });
});
