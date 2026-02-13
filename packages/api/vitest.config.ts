import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@ctp/engine': path.resolve(__dirname, '../engine'),
    },
  },
});
