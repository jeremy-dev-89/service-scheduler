import { Module } from '@nestjs/common';
import { HealthController } from './api/health.controller';
import { CLOCK, SystemClock } from './application/ports';
import { APP_CONFIG, validateConfig } from './config/config.schema';

@Module({
  controllers: [HealthController],
  providers: [
    { provide: APP_CONFIG, useFactory: () => validateConfig(process.env) },
    { provide: CLOCK, useClass: SystemClock },
  ],
})
export class AppModule {}
