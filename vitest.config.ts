import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // Next keeps `jsx: preserve` for its own compiler; vitest needs the automatic runtime.
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    globals: false,
    testTimeout: 30000,
  },
});
