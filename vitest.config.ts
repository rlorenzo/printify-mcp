import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov'],
      include: ['src/**/*.ts'],
      // Registration surface and the CLI entry are covered by the integration
      // test that boots the real server over stdio, not by unit coverage.
      exclude: [
        'src/docs/**',
        // Exercised by the integration test, which boots the built server in a
        // subprocess; that runtime is not visible to the coverage provider.
        'src/index.ts',
        'src/tools.ts',
        'src/stdio-guard.ts'
      ],
      // A floor, not a target: set to the level reached when tests were
      // introduced so coverage cannot regress. Raise it as suites are added.
      thresholds: {
        statements: 13,
        branches: 12,
        functions: 27,
        lines: 14
      }
    }
  }
});
