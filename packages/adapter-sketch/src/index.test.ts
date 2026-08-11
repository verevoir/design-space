import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index.js';

describe('adapter-sketch package entry point', () => {
  it('is reachable through the public entry point under its scoped name', () => {
    expect(PACKAGE_NAME).toBe('@design-space/adapter-sketch');
  });
});
