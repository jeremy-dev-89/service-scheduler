import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { READINESS_CHECK, type ReadinessCheck } from '../application/ports';

type HealthStatus = { status: 'ok' | 'unavailable' };

@Controller('health')
export class HealthController {
  constructor(@Inject(READINESS_CHECK) private readonly readiness: ReadinessCheck) {}

  @Get('live')
  live(): HealthStatus {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<HealthStatus> {
    if (await this.readiness.isReady()) {
      return { status: 'ok' };
    }
    res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: 'unavailable' };
  }
}
