import { Module } from '@nestjs/common';
import { HealthController } from './api/health.controller';
import { CLOCK, SystemClock } from './application/ports';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './infrastructure/database/database.module';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [HealthController],
  providers: [{ provide: CLOCK, useClass: SystemClock }],
})
export class AppModule {}
