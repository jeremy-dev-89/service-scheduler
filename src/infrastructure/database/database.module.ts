import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { READINESS_CHECK, type ReadinessCheck } from '../../application/ports';
import { APP_CONFIG, type AppConfig } from '../../config/config.schema';
import type { Database } from './database.types';

export const KYSELY = Symbol('Kysely');

const READY_TIMEOUT_MS = 1_000;

export function createKysely(databaseUrl: string, poolMax: number): Kysely<Database> {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: poolMax,
    connectionTimeoutMillis: 5_000,
  });
  // An idle client can lose its connection (database restart, network blip). Without a
  // listener, pg re-emits that as an unhandled 'error' event and the process crashes.
  // The pool discards the broken client and opens a new one on the next query.
  const logger = new Logger('DatabasePool');
  pool.on('error', (error) => logger.warn(`Idle database client error: ${error.message}`));
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

/** Readiness: `SELECT 1` must answer within one second. */
@Injectable()
export class DatabaseReadinessCheck implements ReadinessCheck {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  async isReady(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), READY_TIMEOUT_MS);
    });
    try {
      const ping = sql`SELECT 1`.execute(this.db).then(() => true);
      return await Promise.race([ping, timedOut]);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: KYSELY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createKysely(config.databaseUrl, config.dbPoolMax),
    },
    { provide: READINESS_CHECK, useClass: DatabaseReadinessCheck },
  ],
  exports: [KYSELY, READINESS_CHECK],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
