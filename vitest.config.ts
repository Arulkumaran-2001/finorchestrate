import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    // graphql 16 ships CJS and ESM builds without an exports map. Node loads the
    // CJS build for graphql-yoga, so tests must resolve the same copy.
    alias: { graphql: require.resolve('graphql') },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/server/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
});
