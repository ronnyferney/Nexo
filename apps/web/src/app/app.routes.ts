import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';
import { ShellComponent } from './layout/shell.component';

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage) },
  { path: 'register', canActivate: [guestGuard], loadComponent: () => import('./features/auth/register.page').then((m) => m.RegisterPage) },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', loadComponent: () => import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage) },
      { path: 'agents', loadComponent: () => import('./features/agents/agents-list.page').then((m) => m.AgentsListPage) },
      { path: 'agents/:id', loadComponent: () => import('./features/agents/agent-detail.page').then((m) => m.AgentDetailPage) },
      { path: 'connectors', loadComponent: () => import('./features/connectors/connectors-list.page').then((m) => m.ConnectorsListPage) },
      { path: 'connectors/:id', loadComponent: () => import('./features/connectors/connector-detail.page').then((m) => m.ConnectorDetailPage) },
      { path: 'workflows', loadComponent: () => import('./features/workflows/workflows-list.page').then((m) => m.WorkflowsListPage) },
      { path: 'workflows/:id', loadComponent: () => import('./features/workflows/workflow-builder.page').then((m) => m.WorkflowBuilderPage) },
      { path: 'executions', loadComponent: () => import('./features/executions/executions-list.page').then((m) => m.ExecutionsListPage) },
      { path: 'executions/:id', loadComponent: () => import('./features/executions/execution-detail.page').then((m) => m.ExecutionDetailPage) },
      { path: 'settings', loadComponent: () => import('./features/settings/settings.page').then((m) => m.SettingsPage) },
    ],
  },
  { path: '**', redirectTo: '' },
];
