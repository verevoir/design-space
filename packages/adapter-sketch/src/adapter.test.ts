import { describe, it, expect } from 'vitest';
import { sketchAdapter } from './adapter.js';
import type { PromptProps } from '@design-space/port';

// ---------------------------------------------------------------------------
// sketchAdapter — direct tests of the shipped adapter's prompt renderer
//
// All other tests in the repo use stub adapters, so this file provides the
// only direct coverage of the real component sketchAdapter ships.
// ---------------------------------------------------------------------------

describe('sketchAdapter', () => {
  describe('identity', () => {
    it('is named "sketch"', () => {
      expect(sketchAdapter.name).toBe('sketch');
    });

    it('exposes a prompt renderer', () => {
      expect(typeof sketchAdapter.components['prompt']).toBe('function');
    });
  });

  describe('prompt renderer', () => {
    function renderPrompt(props: PromptProps): string {
      return sketchAdapter.components['prompt']!(props as unknown);
    }

    it('renders the heading text inside an h1 element', () => {
      const html = renderPrompt({ heading: 'Choose your plan' });
      expect(html).toContain('<h1');
      expect(html).toContain('Choose your plan');
      expect(html).toContain('</h1>');
    });

    it('uses the ds-prompt class so the render layer can apply its CSS', () => {
      const html = renderPrompt({ heading: 'Hello' });
      expect(html).toContain('ds-prompt');
    });

    it('renders the optional explain text when provided', () => {
      const html = renderPrompt({ heading: 'Title', explain: 'This is the explanation.' });
      expect(html).toContain('This is the explanation.');
      expect(html).toContain('ds-prompt__explain');
    });

    it('omits the explain element entirely when explain is undefined', () => {
      const html = renderPrompt({ heading: 'Title only' });
      expect(html).not.toContain('ds-prompt__explain');
      expect(html).not.toContain('<p');
    });

    it('HTML-escapes special characters in the heading to prevent XSS', () => {
      const html = renderPrompt({ heading: '<script>alert(1)</script>' });
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('HTML-escapes special characters in the explain text to prevent XSS', () => {
      const html = renderPrompt({ heading: 'Safe', explain: '<img src=x onerror=alert(1)>' });
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img');
    });

    it('ampersands in heading are escaped as &amp;', () => {
      const html = renderPrompt({ heading: 'Cats & Dogs' });
      expect(html).toContain('Cats &amp; Dogs');
      expect(html).not.toContain('Cats & Dogs');
    });

    it('double-quotes in heading are escaped as &quot; to stay safe inside HTML attributes', () => {
      const html = renderPrompt({ heading: 'Say "hello"' });
      expect(html).toContain('Say &quot;hello&quot;');
      expect(html).not.toContain('Say "hello"');
    });

    it('double-quotes in explain text are escaped as &quot;', () => {
      const html = renderPrompt({ heading: 'Title', explain: 'Click "OK" to continue.' });
      expect(html).toContain('Click &quot;OK&quot; to continue.');
      expect(html).not.toContain('Click "OK"');
    });
  });
});
