import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Allow test runs without building workspace packages (dist is gitignored).
    alias: {
      'depa-data-graph-core': path.resolve(rootDir, 'packages/core/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'packages/**/test/**/*.test.ts',
      'packages/**/test/**/*.spec.ts',
      'tools/**/test/**/*.test.ts',
      'tools/**/test/**/*.spec.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'packages/core/src/stream/**/*.ts',
        'packages/core/src/watch.ts',
        'packages/core/src/graph.ts',
      ],
      exclude: ['**/*.d.ts', 'packages/core/src/index.ts', 'packages/core/src/stream/index.ts'],
    },
  },
});
