import { Global, Module } from '@nestjs/common';
import { ConversationRetentionService } from './conversation-retention.service';
import { DataProtectionController } from './data-protection.controller';
import { PrivacySettingsService } from './privacy-settings.service';

/** Protección de datos (ADR 0008): ajustes por workspace y retención de conversaciones. DataGuard vive en `llm`. */
@Global()
@Module({
  controllers: [DataProtectionController],
  providers: [PrivacySettingsService, ConversationRetentionService],
  exports: [PrivacySettingsService, ConversationRetentionService],
})
export class DataProtectionModule {}
