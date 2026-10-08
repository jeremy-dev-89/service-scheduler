import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/** State shared by globalSetup and globalTeardown, which run in Jest's parent process. */
interface TestState {
  container?: StartedPostgreSqlContainer;
  databaseReady?: boolean;
}

const holder = globalThis as typeof globalThis & { __schedulerTestState__?: TestState };

export const testState: TestState = (holder.__schedulerTestState__ ??= {});
