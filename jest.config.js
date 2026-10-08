/** @type {import('jest').Config} */
const base = {
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
};

/** @type {import('jest').Config} */
module.exports = {
  testTimeout: 60_000,
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/test/unit/**/*.spec.ts'] },
    { ...base, displayName: 'integration', testMatch: ['<rootDir>/test/integration/**/*.spec.ts'] },
    { ...base, displayName: 'acceptance', testMatch: ['<rootDir>/test/acceptance/**/*.spec.ts'] },
    { ...base, displayName: 'concurrency', testMatch: ['<rootDir>/test/concurrency/**/*.spec.ts'] },
  ],
};
