import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../../common/decorators/current-user.decorator';
import { PlatformFeedbackQueryDto, PlatformRangeDto } from '../dto/copilot.dto';
import { PlatformAdminGuard, PlatformAdminService } from './platform-admin.guard';
import { PlatformMetricsService } from './platform-metrics.service';

/** Consola de plataforma (ADR 0006 D6): solo administradores de Nexo (`PLATFORM_ADMIN_EMAILS`). */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly admins: PlatformAdminService,
    private readonly metrics: PlatformMetricsService,
  ) {}

  @Get('me')
  async me(@CurrentAuth() a: AuthContext) {
    return { isPlatformAdmin: await this.admins.isPlatformAdmin(a) };
  }

  @UseGuards(PlatformAdminGuard)
  @Get('copilot/metrics')
  copilotMetrics(@Query() q: PlatformRangeDto) {
    return this.metrics.metrics(q.from, q.to);
  }

  @UseGuards(PlatformAdminGuard)
  @Get('copilot/feedback')
  copilotFeedback(@Query() q: PlatformFeedbackQueryDto) {
    return this.metrics.feedback({ rating: q.rating, take: q.take });
  }
}
