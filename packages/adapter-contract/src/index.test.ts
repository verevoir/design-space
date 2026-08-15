import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME, assertAdapter, type Adapter } from './index.js';

describe('adapter-contract package entry point', () => {
  it('is reachable through the public entry point under its scoped name', () => {
    expect(PACKAGE_NAME).toBe('@design-space/adapter-contract');
  });
});

const COMPLETE_ADAPTER: Adapter = {
  name: 'complete',
  components: {},
  styles: '.ds-x { color: red; }',
  tokens: { 'ds-x': '#ff0000' },
};

describe('assertAdapter()', () => {
  it('does not throw for an adapter carrying both styles and tokens', () => {
    expect(() => assertAdapter(COMPLETE_ADAPTER, 'test')).not.toThrow();
  });

  it('throws when styles is missing', () => {
    const incomplete = { name: 'x', components: {}, tokens: {} } as unknown as Adapter;
    expect(() => assertAdapter(incomplete, 'test')).toThrow(/styles/);
  });

  it('throws when tokens is missing', () => {
    const incomplete = { name: 'x', components: {}, styles: '' } as unknown as Adapter;
    expect(() => assertAdapter(incomplete, 'test')).toThrow(/tokens/);
  });

  it('throws when tokens is an array rather than a record', () => {
    const wrong = { name: 'x', components: {}, styles: '', tokens: [] } as unknown as Adapter;
    expect(() => assertAdapter(wrong, 'test')).toThrow(/tokens/);
  });

  it('names the adapter and the calling context in the error message', () => {
    const incomplete = { name: 'my-adapter', components: {}, tokens: {} } as unknown as Adapter;
    expect(() => assertAdapter(incomplete, 'render()')).toThrow(/my-adapter/);
    expect(() => assertAdapter(incomplete, 'render()')).toThrow(/render\(\)/);
  });
});
