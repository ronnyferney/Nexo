import { Global, Module } from '@nestjs/common';
import { ConversationRetentionService } from './conversation-retention.service';
import { DataProtectionController } from './data-protection.controller';
import { PrivacySettingsService } from './privacy-settings.service';
import { RetentionPolicyController } from './retention-policy.controller';
import { RetentionPolicyService } from './retention-policy.service';

/**
 * Protección de datos (ADR 0008 · P0.2): ajustes por workspace, retención de conversaciones y políticas de retención
 * diferenciadas por org/canal/tipo. DataGuard vive en `llm`; `AuditService` se inyecta vía su módulo `@Global`.
 */
@Global()
@Module({
  controllers: [DataProtectionController, RetentionPolicyController],
  providers: [PrivacySettingsService, ConversationRetentionService, RetentionPolicyService],
  exports: [PrivacySettingsService, ConversationRetentionService, RetentionPolicyService],
})
export class DataProtectionModule {}
