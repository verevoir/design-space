import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.d.ts'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Deep imports into any @design-space/* package bypass the declared
              // public entry point (the single "." export in each package.json).
              // Import from the package root only: import { x } from '@design-space/pkg'.
              regex: '^@design-space/[^/]+/.+',
              message:
                "Deep imports across @design-space/* packages are forbidden. Import from the package root only: import { x } from '@design-space/<pkg>'.",
            },
          ],
        },
      ],
    },
  },
);
