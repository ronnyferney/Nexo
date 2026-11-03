import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../../../core/api.service';
import { ToastService } from '../../../core/toast.service';
import type { BudgetOverride, BudgetRow } from '../../../core/models';
import { BudgetOverridesComponent } from './budget-overrides.component';

function override(partial: Partial<BudgetOverride> = {}): BudgetOverride {
  return {
    id: 'o1',
    orgUnitId: 'u1',
    agentId: null,
    periodKey: '2026-M11',
    motivo: 'Campaña de fin de año',
    limitExtraUsd: 50,
    grantedByUserId: 'user1',
    grantedByRole: 'ADMIN',
    expiresAt: '2099-01-01T00:00:00.000Z',
    revokedAt: null,
    vigente: true,
    createdAt: '2026-11-01T00:00:00.000Z',
    ...partial,
  };
}

const unit: BudgetRow = {
  orgUnitId: 'u1',
  orgUnitName: 'Ventas',
  parentId: null,
  budget: {
    period: 'MONTHLY',
    limitUsd: 100,
    policy: 'BLOCK',
    alertThresholds: [80, 90, 100],
    downgradeProviderId: null,
    downgradeModel: null,
    critico: true,
    impactoValidadoAt: null,
    degradacionHabilitada: false,
  },
  periodKey: '2026-M11',
  overrideActive: true,
  spentUsd: 10,
  pct: 10,
};

describe('BudgetOverridesComponent', () => {
  let fixture: ComponentFixture<BudgetOverridesComponent>;
  let el: HTMLElement;

  async function setup(api: Partial<ApiService>, canEdit = true) {
    await TestBed.configureTestingModule({
      imports: [BudgetOverridesComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: { success: () => {}, error: () => {} } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(BudgetOverridesComponent);
    fixture.componentRef.setInput('canEdit', canEdit);
    fixture.componentRef.setInput('units', [unit]);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('muestra las autorizaciones y el nombre de la unidad', async () => {
    await setup({ budgetOverrides: () => Promise.resolve([override()]), agentBudgets: () => Promise.resolve([]) });
    const texto = el.textContent ?? '';
    expect(texto).toContain('Ventas');
    expect(texto).toContain('Campaña de fin de año');
    expect(texto).toContain('Vigente');
  });

  it('muestra el mensaje vacío sin autorizaciones', async () => {
    await setup({ budgetOverrides: () => Promise.resolve([]), agentBudgets: () => Promise.resolve([]) });
    expect(el.textContent ?? '').toContain('No hay autorizaciones registradas');
  });

  it('muestra el estado de error ante un fallo de carga', async () => {
    await setup({
      budgetOverrides: () => Promise.reject(new HttpErrorResponse({ status: 500, statusText: 'x' })),
      agentBudgets: () => Promise.resolve([]),
    });
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('oculta las acciones (conceder/revocar) sin permiso de edición', async () => {
    await setup(
      { budgetOverrides: () => Promise.resolve([override()]), agentBudgets: () => Promise.resolve([]) },
      false,
    );
    const botones = Array.from(el.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '');
    expect(botones.some((t) => t.includes('Conceder'))).toBeFalse();
    expect(botones.some((t) => t.includes('Revocar'))).toBeFalse();
  });
});
