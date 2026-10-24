import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { OptionalAuth, Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedRequest } from '../../common/guards/auth.guard';
import { LoginAccountThrottlerGuard } from '../../common/guards/login-throttler.guard';
import { CSRF_COOKIE, readCookie, SessionCookieService } from '../../common/guards/session-cookie.service';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  SwitchWorkspaceDto,
} from './dto/auth.dto';

/**
 * Sesión: login, cambio de contraseña, cambio de workspace y aceptación de invitación emiten o renuevan la cookie de
 * sesión de la web (M6, `SessionCookieService`). El cuerpo sigue trayendo `accessToken` para clientes con Bearer.
 */
@ApiTags('auth')
@ApiBearerAuth()
@ApiCookieAuth('nexo_session')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: SessionCookieService,
  ) {}

  /** Modo de registro y si hay correo saliente (la web oculta «Crear cuenta» con `invite_only`). */
  @Public()
  @Get('config')
  config() {
    return this.auth.publicConfig();
  }

  /** Respuesta genérica, exista o no el correo (B4); no inicia sesión. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  /** Límite por IP (10/min, `ThrottlerGuard` global) y por cuenta (`LoginAccountThrottlerGuard`). */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(LoginAccountThrottlerGuard)
  @HttpCode(200)
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.login(dto);
    this.cookies.set(res, session.accessToken);
    return session;
  }

  /**
   * Cierra la sesión: revoca el token (su `jti`) y borra las cookies. Sin sesión válida responde igual y solo borra
   * las cookies, para que la web siempre pueda salir. Con la cookie exige el token CSRF, como toda escritura.
   */
  @OptionalAuth()
  @HttpCode(200)
  @Post('logout')
  async logout(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.logout(req.user?.via === 'jwt' ? req.sessionCredential : undefined);
    this.cookies.clear(res);
    return result;
  }

  @Get('me')
  me(@CurrentAuth() auth: AuthContext, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    const userId = userOf(auth);
    // El navegador conserva la sesión pero perdió la cookie CSRF (borrado parcial): se vuelve a emitir.
    const credential = req.sessionCredential;
    if (credential?.source === 'cookie' && !readCookie(req, CSRF_COOKIE)) {
      const maxAge = credential.exp ? Math.max(credential.exp * 1000 - Date.now(), 0) : undefined;
      this.cookies.setCsrf(res, credential.token, maxAge);
    }
    return this.auth.me(userId, auth.workspaceId);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('change-password')
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!auth.userId) throw new ForbiddenException('Las API keys no tienen contraseña');
    const result = await this.auth.changePassword(auth.userId, auth.workspaceId, dto);
    this.cookies.set(res, result.accessToken);
    return result;
  }

  /**
   * Pide el enlace de recuperación de contraseña: respuesta genérica siempre (exista o no la cuenta). Sin SMTP, 503.
   * Límite por IP (5 cada 15 min) y, por cuenta, como mucho 3 enlaces vigentes.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @HttpCode(202)
  @Post('password/forgot')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.requestPasswordReset(dto.email);
  }

  /** Fija la contraseña nueva con el enlace (un solo uso, 30 min) y cierra todas las sesiones; no inicia sesión. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('password/reset')
  async resetPassword(@Body() dto: ResetPasswordDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.resetPassword(dto.token, dto.password);
    // Si este navegador tenía una sesión, ya no vale: se borran sus cookies.
    this.cookies.clear(res);
    return result;
  }

  /** Envía a su correo el enlace de verificación (C1). Requiere SMTP. */
  @Throttle({ default: { limit: 3, ttl: 10 * 60_000 } })
  @HttpCode(200)
  @Post('verify-email/request')
  requestVerification(@CurrentAuth() auth: AuthContext) {
    return this.auth.requestEmailVerification(userOf(auth));
  }

  /** Confirma el correo con el enlace recibido; exige la sesión de la misma cuenta. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('verify-email/:token')
  confirmVerification(@CurrentAuth() auth: AuthContext, @Param('token') token: string) {
    return this.auth.confirmEmailVerification(userOf(auth), token);
  }

  /** Con la cookie, la sesión del workspace anterior se cierra: el navegador solo conserva la nueva. */
  @HttpCode(200)
  @Post('switch-workspace')
  async switch(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: SwitchWorkspaceDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.issue(userOf(auth), dto.workspaceId);
    if (req.sessionCredential?.source === 'cookie') await this.auth.logout(req.sessionCredential);
    this.cookies.set(res, session.accessToken);
    return session;
  }
}

/** Las API keys pertenecen al workspace, no a un usuario: los endpoints de cuenta responden 403 (antes, 500). */
function userOf(auth: AuthContext): string {
  if (!auth.userId) throw new ForbiddenException('Esta operación requiere una sesión de usuario, no una API key');
  return auth.userId;
}
