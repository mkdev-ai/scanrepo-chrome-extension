import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    restoreMocks: true,
  },
});