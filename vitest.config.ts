import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `tests/` holds the antagonistic-review gate's own tests. They live outside the packages
    // because the thing they cover — the scripts in .github/antagonistic-review/ — is not a
    // package, and the gate's decision logic has to stay tested where it runs.
    include: ['packages/*/src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
