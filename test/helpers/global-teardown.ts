import { testState } from './test-state';

export default async function globalTeardown(): Promise<void> {
  const container = testState.container;
  testState.container = undefined;
  testState.databaseReady = false;
  await container?.stop();
}
