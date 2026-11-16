import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the built prototype can be opened from any static host or sub-path.
  base: './',
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Some tests are exhaustive searches over a level (proofs that no shortcut exists).
    // The slowest takes about five seconds on a laptop and more on a shared CI runner.
    testTimeout: 60_000,
  },
});
