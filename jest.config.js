/** @type {import('jest').Config} */
const base = {
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
};

/** Integration, acceptance and concurrency share one Testcontainers PostgreSQL per run. */
const withDatabase = {
  ...base,
  globalSetup: '<rootDir>/test/helpers/global-setup.ts',
  globalTeardown: '<rootDir>/test/helpers/global-teardown.ts',
};

/** @type {import('jest').Config} */
module.exports = {
  testTimeout: 60_000,
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/test/unit/**/*.spec.ts'] },
    {
      ...withDatabase,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
    },
    {
      ...withDatabase,
      displayName: 'acceptance',
      testMatch: ['<rootDir>/test/acceptance/**/*.spec.ts'],
    },
    {
      ...withDatabase,
      displayName: 'concurrency',
      testMatch: ['<rootDir>/test/concurrency/**/*.spec.ts'],
    },
  ],
};
