import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Local delivery snapshots and sibling products are not this release's tests.
    include: ['tests/**/*.test.ts', 'desktop/windows/**/*.test.ts'],
  },
});
