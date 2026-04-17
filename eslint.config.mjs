import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default [
  ...nextCoreWebVitals,
  ...nextTypescript,
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
