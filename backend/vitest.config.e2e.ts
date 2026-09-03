import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Same cold-node_modules headroom reasoning as vitest.config.ts's hookTimeout — see there.
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
