import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from '../../common/guards/auth.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { BootstrapAdminService } from './bootstrap-admin.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('jwt.secret'),
        signOptions: { expiresIn: config.get('jwt.expiresIn') ?? '12h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, BootstrapAdminService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
