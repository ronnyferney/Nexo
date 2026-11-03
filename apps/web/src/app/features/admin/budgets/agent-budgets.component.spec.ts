import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../../../core/api.service';
import { ToastService } from '../../../core/toast.service';
import type { AgentBudgetRow } from '../../../core/models';
import { AgentBudgetsComponent } from './agent-budgets.component';

function row(partial: Partial<AgentBudgetRow> = {}): AgentBudgetRow {
  return {
    agentId: 'a1',
    agentName: 'Asistente Ventas',
    period: 'MONTHLY',
    periodKey: '2026-M11',
    limitUsd: 50,
    policy: 'BLOCK',
    alertThresholds: [80, 90, 100],
    downgradeProviderId: null,
    downgradeModel: null,
    critico: true,
    impactoValidadoAt: null,
    spentUsd: 12.5,
    pct: 25,
    ...partial,
  };
}

describe('AgentBudgetsComponent', () => {
  let fixture: ComponentFixture<AgentBudgetsComponent>;
  let el: HTMLElement;

  async function setup(api: Partial<ApiService>, canEdit = true) {
    await TestBed.configureTestingModule({
      imports: [AgentBudgetsComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: { success: () => {}, error: () => {} } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AgentBudgetsComponent);
    fixture.componentRef.setInput('canEdit', canEdit);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('muestra las bolsas por agente con su consumo', async () => {
    await setup({
      agentBudgets: () => Promise.resolve([row()]),
      agents: () => Promise.resolve([]),
      llmCatalog: () => Promise.resolve([]),
    });
    const texto = el.textContent ?? '';
    expect(texto).toContain('Asistente Ventas');
    expect(texto).toContain('Crítico');
  });

  it('muestra el mensaje vacío sin bolsas', async () => {
    await setup({
      agentBudgets: () => Promise.resolve([]),
      agents: () => Promise.resolve([]),
      llmCatalog: () => Promise.resolve([]),
    });
    expect(el.textContent ?? '').toContain('Ningún agente tiene bolsa propia');
  });

  it('muestra el estado de error ante un fallo de carga', async () => {
    await setup({
      agentBudgets: () => Promise.reject(new HttpErrorResponse({ status: 500, statusText: 'x' })),
      agents: () => Promise.resolve([]),
      llmCatalog: () => Promise.resolve([]),
    });
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('oculta las acciones de edición sin permiso', async () => {
    await setup(
      { agentBudgets: () => Promise.resolve([row()]), agents: () => Promise.resolve([]), llmCatalog: () => Promise.resolve([]) },
      false,
    );
    const botones = Array.from(el.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '');
    expect(botones.some((t) => t.includes('Editar'))).toBeFalse();
    expect(botones.some((t) => t.includes('Quitar bolsa'))).toBeFalse();
  });
});
