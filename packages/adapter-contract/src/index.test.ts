import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME, assertAdapter, AdapterContentError, type Adapter } from './index.js';

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

describe('assertAdapter() content validation', () => {
  it('rejects styles containing a closing style tag', () => {
    const adapter = { ...COMPLETE_ADAPTER, styles: '.x{}</style><script>alert(1)</script>' };
    expect(() => assertAdapter(adapter, 'test')).toThrow(AdapterContentError);
  });

  it('rejects a closing style tag regardless of case', () => {
    const adapter = { ...COMPLETE_ADAPTER, styles: '.x{}</STYLE>' };
    expect(() => assertAdapter(adapter, 'test')).toThrow(AdapterContentError);
  });

  it('accepts ordinary CSS carrying comments, quoted content and a media query', () => {
    const adapter = {
      ...COMPLETE_ADAPTER,
      styles: '/* comment */ .x { content: "hi"; } @media (min-width: 1px) { .y { color: red; } }',
    };
    expect(() => assertAdapter(adapter, 'test')).not.toThrow();
  });

  it('rejects a token name that is not lowercase-hyphen', () => {
    const adapter = { ...COMPLETE_ADAPTER, tokens: { 'Ds Accent': '#fff' } };
    expect(() => assertAdapter(adapter, 'test')).toThrow(AdapterContentError);
  });

  it('accepts a token name following the ds-* convention', () => {
    const adapter = { ...COMPLETE_ADAPTER, tokens: { 'ds-accent-2': '#fff' } };
    expect(() => assertAdapter(adapter, 'test')).not.toThrow();
  });

  it('rejects a token value that would close the :root rule early', () => {
    const adapter = { ...COMPLETE_ADAPTER, tokens: { 'ds-x': '#fff } </style><script>' } };
    expect(() => assertAdapter(adapter, 'test')).toThrow(AdapterContentError);
  });

  it('rejects a token value containing an unterminated comment opener', () => {
    const adapter = { ...COMPLETE_ADAPTER, tokens: { 'ds-x': 'red /* ' } };
    expect(() => assertAdapter(adapter, 'test')).toThrow(AdapterContentError);
  });

  it('accepts a quoted font stack as a token value', () => {
    const adapter = {
      ...COMPLETE_ADAPTER,
      tokens: { 'ds-font-body': '"Helvetica Neue", sans-serif' },
    };
    expect(() => assertAdapter(adapter, 'test')).not.toThrow();
  });

  it('accepts calc() with all four arithmetic operators', () => {
    const adapter = {
      ...COMPLETE_ADAPTER,
      tokens: {
        'ds-a': 'calc(100% - 2px)',
        'ds-b': 'calc(100% + 2px)',
        'ds-c': 'calc(2 * 3px)',
        'ds-d': 'calc(100% / 2)',
      },
    };
    expect(() => assertAdapter(adapter, 'test')).not.toThrow();
  });
});
