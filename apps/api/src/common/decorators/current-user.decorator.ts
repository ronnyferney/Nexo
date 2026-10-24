import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthContext {
  userId?: string;
  workspaceId: string;
  role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
  via: 'jwt' | 'apiKey';
  /** Solo con API key (B3): identificador y alcances de la clave. */
  apiKeyId?: string;
  scopes?: string[];
}

/** Inyecta el contexto autenticado (usuario + workspace activo). */
export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  return ctx.switchToHttp().getRequest<{ user: AuthContext }>().user;
});
