module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['dist', 'node_modules', '*.js'],
  rules: {
    // context/code-standards.md: no `any` in production code — error, not warn.
    '@typescript-eslint/no-explicit-any': 'error',
  },
  overrides: [
    {
      // Test files may use `any` for mocks and fixtures.
      files: ['**/*.spec.ts', 'test/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
