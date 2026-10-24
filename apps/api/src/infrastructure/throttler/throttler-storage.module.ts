import { Module } from '@nestjs/common';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/** Provee el almacenamiento en Redis que `ThrottlerModule.forRootAsync` entrega al limitador. */
@Module({ providers: [RedisThrottlerStorage], exports: [RedisThrottlerStorage] })
export class ThrottlerStorageModule {}
