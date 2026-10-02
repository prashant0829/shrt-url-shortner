import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.js'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.js'],
          globalSetup: ['test/integration/global-setup.js'],
          // Suites share one Postgres database and one Redis DB, so files must run one at a time.
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/server.js', 'src/worker.js', 'src/infra/migrate-cli.js'],
      reporter: ['text-summary', 'html', 'lcov'],
    },
  },
});
