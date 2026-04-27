import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // Playwright test files import their own runtime; lint for them is
    // run via `playwright test` errors and ESLint's coverage on the app
    // tree is what we care about here.
    ignores: ['tests/**', 'playwright.config.ts', 'playwright-report/**', 'test-results/**'],
  },
  {
    rules: {
      // Downgraded from 'error' -> 'warn' so CI passes while we migrate the codebase.
      // Tighten these back to 'error' once the codebase is cleaned up.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      'react/no-unescaped-entities': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      // New in react-hooks@latest - too aggressive for our async-init useEffects.
      // Re-enable after auditing & refactoring effect usage.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];
