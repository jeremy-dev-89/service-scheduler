import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { READINESS_CHECK, type ReadinessCheck } from '../application/ports';

class HealthStatus {
  @ApiProperty({ enum: ['ok', 'unavailable'], example: 'ok' })
  status!: 'ok' | 'unavailable';
}

@ApiTags('operations')
@Controller('health')
export class HealthController {
  constructor(@Inject(READINESS_CHECK) private readonly readiness: ReadinessCheck) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness: the process is running' })
  @ApiOkResponse({ type: HealthStatus })
  live(): HealthStatus {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness: the database answers SELECT 1 within one second' })
  @ApiOkResponse({ type: HealthStatus })
  @ApiServiceUnavailableResponse({ type: HealthStatus, description: 'Database unreachable' })
  async ready(@Res({ passthrough: true }) res: Response): Promise<HealthStatus> {
    if (await this.readiness.isReady()) {
      return { status: 'ok' };
    }
    res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: 'unavailable' };
  }
}
