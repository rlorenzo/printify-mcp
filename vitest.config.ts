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
        // Only reached by the integration test, which boots the built server in
        // a subprocess; that runtime is invisible to the coverage provider, so
        // including them would report a misleading 0%.
        'src/index.ts',
        'src/stdio-guard.ts'
      ],
      // A floor, not a target: set to the level reached when tests were
      // introduced so coverage cannot regress. Raise it as suites are added.
      thresholds: {
        statements: 78,
        branches: 77,
        functions: 77,
        lines: 78
      }
    }
  }
});
