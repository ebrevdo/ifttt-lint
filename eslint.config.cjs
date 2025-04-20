const parser = require('@typescript-eslint/parser');
const plugin = require('@typescript-eslint/eslint-plugin');

/**
 * ESLint flat configuration for TypeScript code.
 */
module.exports = [
  // Ignore generated, test, and non-source files
  {
    ignores: ['node_modules/**', 'dist/**'],
  },
  // Parser settings for all files
  {
    languageOptions: {
      parser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
      },
    },
  },
  // TypeScript rules for source files
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'perf/**/*.ts'],
    plugins: {
      '@typescript-eslint': plugin,
    },
    rules: {
      // Recommended TypeScript rules
      ...plugin.configs.recommended.rules,
      // Allow console statements (used for CLI logging)
      'no-console': 'off',
      // Do not require explicit return types on functions
      '@typescript-eslint/explicit-function-return-type': 'off',
      // Allow require() in tests and CLI scripts
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];