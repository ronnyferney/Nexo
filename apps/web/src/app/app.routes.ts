import { Routes } from '@angular/router';
import { adminGuard, authGuard, guestGuard, platformGuard } from './core/auth.guard';
import { ShellComponent } from './layout/shell.component';

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage) },
  { path: 'register', canActivate: [guestGuard], loadComponent: () => import('./features/auth/register.page').then((m) => m.RegisterPage) },
  // Públicas (C1): aceptar una invitación y confirmar el correo; la sesión, si hace falta, la piden las propias páginas.
  { path: 'invitacion/:token', loadComponent: () => import('./features/auth/invitation.page').then((m) => m.InvitationPage) },
  { path: 'verificar-correo/:token', loadComponent: () => import('./features/auth/verify-email.page').then((m) => m.VerifyEmailPage) },
  // Recuperación de contraseña por correo: pedir el enlace y elegir la contraseña nueva (el token va en la ruta).
  { path: 'olvide-contrasena', loadComponent: () => import('./features/auth/forgot-password.page').then((m) => m.ForgotPasswordPage) },
  { path: 'restablecer/:token', loadComponent: () => import('./features/auth/reset-password.page').then((m) => m.ResetPasswordPage) },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      // Portal de usuarios (todos los roles)
      { path: '', loadComponent: () => import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage) },
      { path: 'agents', loadComponent: () => import('./features/agents/agents-list.page').then((m) => m.AgentsListPage) },
      { path: 'agents/explore', loadComponent: () => import('./features/agents/explore/explore-agents.page').then((m) => m.ExploreAgentsPage) },
      { path: 'agents/new', loadComponent: () => import('./features/agents/agent-new.page').then((m) => m.AgentNewPage) },
      { path: 'agents/:id', loadComponent: () => import('./features/agents/agent-detail.page').then((m) => m.AgentDetailPage) },
      { path: 'connectors', loadComponent: () => import('./features/connectors/connectors-list.page').then((m) => m.ConnectorsListPage) },
      { path: 'integrations', loadComponent: () => import('./features/integrations/integrations.page').then((m) => m.IntegrationsPage) },
      { path: 'connectors/:id', loadComponent: () => import('./features/connectors/connector-detail.page').then((m) => m.ConnectorDetailPage) },
      { path: 'workflows', loadComponent: () => import('./features/workflows/workflows-list.page').then((m) => m.WorkflowsListPage) },
      { path: 'workflows/:id', loadComponent: () => import('./features/workflows/workflow-builder.page').then((m) => m.WorkflowBuilderPage) },
      { path: 'executions', loadComponent: () => import('./features/executions/executions-list.page').then((m) => m.ExecutionsListPage) },
      { path: 'executions/:id', loadComponent: () => import('./features/executions/execution-detail.page').then((m) => m.ExecutionDetailPage) },
      { path: 'skills', loadComponent: () => import('./features/skills/skills.page').then((m) => m.SkillsPage) },
      { path: 'knowledge', loadComponent: () => import('./features/knowledge/knowledge-list.page').then((m) => m.KnowledgeListPage) },
      { path: 'knowledge/:id', loadComponent: () => import('./features/knowledge/knowledge-detail.page').then((m) => m.KnowledgeDetailPage) },
      { path: 'routines', loadComponent: () => import('./features/routines/routines.page').then((m) => m.RoutinesPage) },
      { path: 'supervision', loadComponent: () => import('./features/supervision/supervision.page').then((m) => m.SupervisionPage) },
      { path: 'account', loadComponent: () => import('./features/account/account.page').then((m) => m.AccountPage) },
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
          { path: 'groups', loadComponent: () => import('./features/admin/groups.page').then((m) => m.GroupsPage) },
          { path: 'budgets', loadComponent: () => import('./features/admin/budgets.page').then((m) => m.BudgetsPage) },
          { path: 'alerts', loadComponent: () => import('./features/admin/alerts.page').then((m) => m.AlertsPage) },
          { path: 'edges', loadComponent: () => import('./features/admin/edges.page').then((m) => m.EdgesPage) },
          { path: 'security', loadComponent: () => import('./features/admin/security.page').then((m) => m.SecurityPage) },
          { path: 'settings', loadComponent: () => import('./features/admin/workspace-settings.page').then((m) => m.WorkspaceSettingsPage) },
        ],
      },

      // Consola de plataforma Nexo (administradores de Nexo, ADR 0006 D6) — separada de la administración del cliente
      {
        path: 'platform',
        canActivate: [platformGuard],
        children: [
          { path: '', loadComponent: () => import('./features/platform/platform-success.page').then((m) => m.PlatformSuccessPage) },
          { path: 'copilot-quality', loadComponent: () => import('./features/platform/platform-quality.page').then((m) => m.PlatformQualityPage) },
          { path: 'oauth-apps', loadComponent: () => import('./features/platform/platform-oauth-apps.page').then((m) => m.PlatformOAuthAppsPage) },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
