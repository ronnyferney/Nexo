import { Module } from '@nestjs/common';
import { SingleUseService } from './single-use.service';

/** Uso único de identificadores (`jti`, nonces) compartido entre réplicas en Redis (auditoría B2). */
@Module({ providers: [SingleUseService], exports: [SingleUseService] })
export class SingleUseModule {}
