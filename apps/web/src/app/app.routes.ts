import { Routes } from '@angular/router';
import { adminGuard, authGuard, guestGuard } from './core/auth.guard';
import { ShellComponent } from './layout/shell.component';

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage) },
  { path: 'register', canActivate: [guestGuard], loadComponent: () => import('./features/auth/register.page').then((m) => m.RegisterPage) },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      // Portal de usuarios (todos los roles)
      { path: '', loadComponent: () => import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage) },
      { path: 'agents', loadComponent: () => import('./features/agents/agents-list.page').then((m) => m.AgentsListPage) },
      { path: 'agents/:id', loadComponent: () => import('./features/agents/agent-detail.page').then((m) => m.AgentDetailPage) },
      { path: 'connectors', loadComponent: () => import('./features/connectors/connectors-list.page').then((m) => m.ConnectorsListPage) },
      { path: 'connectors/:id', loadComponent: () => import('./features/connectors/connector-detail.page').then((m) => m.ConnectorDetailPage) },
      { path: 'workflows', loadComponent: () => import('./features/workflows/workflows-list.page').then((m) => m.WorkflowsListPage) },
      { path: 'workflows/:id', loadComponent: () => import('./features/workflows/workflow-builder.page').then((m) => m.WorkflowBuilderPage) },
      { path: 'executions', loadComponent: () => import('./features/executions/executions-list.page').then((m) => m.ExecutionsListPage) },
      { path: 'executions/:id', loadComponent: () => import('./features/executions/execution-detail.page').then((m) => m.ExecutionDetailPage) },
      { path: 'my-usage', loadComponent: () => import('./features/usage/my-usage.page').then((m) => m.MyUsagePage) },
      { path: 'settings', redirectTo: 'admin/security', pathMatch: 'full' },

      // Consola de administración (ADMIN / OWNER)
      {
        path: 'admin',
        canActivate: [adminGuard],
        children: [
          { path: '', loadComponent: () => import('./features/admin/costs.page').then((m) => m.CostsPage) },
          { path: 'providers', loadComponent: () => import('./features/admin/providers.page').then((m) => m.ProvidersPage) },
          { path: 'organization', loadComponent: () => import('./features/admin/organization.page').then((m) => m.OrganizationPage) },
          { path: 'budgets', loadComponent: () => import('./features/admin/budgets.page').then((m) => m.BudgetsPage) },
          { path: 'alerts', loadComponent: () => import('./features/admin/alerts.page').then((m) => m.AlertsPage) },
          { path: 'security', loadComponent: () => import('./features/admin/security.page').then((m) => m.SecurityPage) },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
