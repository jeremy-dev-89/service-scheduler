import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, validateConfig } from './config.schema';

/** Validates the environment once at startup and shares the result. */
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => validateConfig(process.env) }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
