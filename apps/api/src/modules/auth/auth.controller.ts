import { Body, Controller, ForbiddenException, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { LoginAccountThrottlerGuard } from '../../common/guards/login-throttler.guard';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RegisterDto, SwitchWorkspaceDto } from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentAuth() auth: AuthContext) {
    return this.auth.me(userOf(auth), auth.workspaceId);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('change-password')
  changePassword(@CurrentAuth() auth: AuthContext, @Body() dto: ChangePasswordDto) {
    if (!auth.userId) throw new ForbiddenException('Las API keys no tienen contraseña');
    return this.auth.changePassword(auth.userId, dto);
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('switch-workspace')
  switch(@CurrentAuth() auth: AuthContext, @Body() dto: SwitchWorkspaceDto) {
    return this.auth.issue(userOf(auth), dto.workspaceId);
  }
}

/** Las API keys pertenecen al workspace, no a un usuario: los endpoints de cuenta responden 403 (antes, 500). */
function userOf(auth: AuthContext): string {
  if (!auth.userId) throw new ForbiddenException('Esta operación requiere una sesión de usuario, no una API key');
  return auth.userId;
}
