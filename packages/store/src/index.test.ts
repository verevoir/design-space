import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME, ObjectNotFoundError, ObjectLookupError, InvalidRefError } from './index.js';

describe('store package entry point', () => {
  it('is reachable through the public entry point under its scoped name', () => {
    expect(PACKAGE_NAME).toBe('@design-space/store');
  });

  it('exports ObjectNotFoundError through the public entry point', () => {
    // Consumers must be able to import and instanceof-check ObjectNotFoundError
    // without a deep import (boundary rule: @design-space/*/** is forbidden).
    expect(typeof ObjectNotFoundError).toBe('function');
    const err = new ObjectNotFoundError(
      { kind: 'journey', id: 'test' },
      'abc123',
    );
    expect(err).toBeInstanceOf(ObjectNotFoundError);
    expect(err).toBeInstanceOf(Error);
  });

  it('exports ObjectLookupError through the public entry point', () => {
    expect(typeof ObjectLookupError).toBe('function');
    const err = new ObjectLookupError(
      { kind: 'journey', id: 'test' },
      'abc123',
      new Error('cause'),
    );
    expect(err).toBeInstanceOf(ObjectLookupError);
    expect(err).toBeInstanceOf(Error);
  });

  it('exports InvalidRefError through the public entry point', () => {
    // InvalidRefError is the third documented error type — a consumer needs it
    // to distinguish a rejected input (InvalidRefError) from a missing object
    // (ObjectNotFoundError) or a retriable lookup failure (ObjectLookupError).
    expect(typeof InvalidRefError).toBe('function');
    const err = new InvalidRefError('ref', '--bad-value', 'must not start with a dash');
    expect(err).toBeInstanceOf(InvalidRefError);
    expect(err).toBeInstanceOf(Error);
  });
});
