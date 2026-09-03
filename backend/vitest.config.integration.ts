import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Requires a live PostgreSQL database at DATABASE_URL with the current migration applied.
// Not part of `npm test` (unit tests, no database required) for the same reason test:e2e isn't:
// it needs real infrastructure this repo does not provision on its own.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.integration-spec.ts'],
    // Same cold-node_modules headroom reasoning as vitest.config.ts's hookTimeout — see there.
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
