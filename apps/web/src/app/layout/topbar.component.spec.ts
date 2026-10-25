import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TopbarComponent } from './topbar.component';

@Component({
  standalone: true,
  imports: [TopbarComponent],
  template: `
    <nx-topbar [showMenu]="showMenu" (menuToggle)="toggled = toggled + 1">
      <span class="title">Inicio</span>
      <button actions class="btn">Acción</button>
    </nx-topbar>
  `,
})
class HostComponent {
  showMenu = false;
  toggled = 0;
}

describe('TopbarComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('expone un landmark banner y proyecta contenido y acciones', () => {
    expect(el.querySelector('header.topbar')?.getAttribute('role')).toBe('banner');
    expect(el.querySelector('.topbar-start .title')?.textContent).toContain('Inicio');
    expect(el.querySelector('.topbar-end .btn')?.textContent).toContain('Acción');
  });

  it('no muestra el botón de menú por defecto', () => {
    expect(el.querySelector('.menu-toggle')).toBeNull();
  });

  it('muestra el botón de menú accesible y emite menuToggle al pulsarlo', () => {
    fixture.componentInstance.showMenu = true;
    fixture.detectChanges();
    const btn = el.querySelector('.menu-toggle') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-label')).toBe('Abrir navegación');
    btn.click();
    expect(fixture.componentInstance.toggled).toBe(1);
  });
});
