import { Controller, Get, Header, Inject, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { METRICS_EXPORTER, type MetricsExporter } from '../application/ports';

@ApiTags('operations')
@Controller('metrics')
export class MetricsController {
  constructor(@Inject(METRICS_EXPORTER) private readonly metrics: MetricsExporter) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Prometheus metrics' })
  @ApiProduces('text/plain')
  @ApiOkResponse({ description: 'Prometheus text exposition format', schema: { type: 'string' } })
  async scrape(@Res({ passthrough: true }) res: Response): Promise<string> {
    res.setHeader('Content-Type', this.metrics.contentType);
    return this.metrics.render();
  }
}
