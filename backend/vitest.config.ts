import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // A cold `npm ci` writes a large node_modules tree; the first process to read through it
    // (module resolution, TS project scan, Vite's own file-system work) pays real first-access
    // disk I/O + antivirus-scan cost on Windows that can exceed Vitest's 10s default hookTimeout
    // even though the test itself runs in well under a second once the files are warm in the OS
    // cache. Verified: clearing only node_modules/.vite (Vite's own dependency-pre-bundle cache)
    // while leaving the rest of node_modules warm does NOT reproduce the slowdown, so this is not
    // a Vite-internal caching issue — it is specific to a freshly-written node_modules on disk.
    // Generous headroom here costs nothing on a warm run and removes the failure mode entirely.
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
