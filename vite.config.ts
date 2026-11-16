import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the built prototype can be opened from any static host or sub-path.
  base: './',
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
