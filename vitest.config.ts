import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: 'leak',
          include: ['test/leak/**/*.test.ts'],
          environment: 'node',
          testTimeout: 30 * 60_000,
        },
      },
    ],
  },
});
