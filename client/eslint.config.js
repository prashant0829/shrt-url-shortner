import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  // The production build is written next to the server, outside this folder.
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },
  js.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  jsxA11y.flatConfigs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      // React 19 ignores propTypes at runtime, and the components are covered by tests.
      'react/prop-types': 'off',
      // User-controlled text (URLs, aliases) must never be injected as HTML.
      'react/no-danger': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ClassDeclaration',
          message: 'Use a factory function (createX) instead of a class.',
        },
        {
          selector: 'ClassExpression',
          message: 'Use a factory function (createX) instead of a class.',
        },
      ],
    },
  },
  {
    files: ['vite.config.js', 'eslint.config.js', '**/*.test.{js,jsx}', 'src/test/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  prettier,
];
