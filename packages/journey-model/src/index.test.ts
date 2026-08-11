import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index.js';

describe('journey-model package entry point', () => {
  it('is reachable through the public entry point under its scoped name', () => {
    expect(PACKAGE_NAME).toBe('@design-space/journey-model');
  });
});
