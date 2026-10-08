import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'src/generated/**',
      'node_modules/**',
      'prisma/migrations/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.js', 'prettier.config.js', 'vitest.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['eslint.config.js'],
    rules: {
      '@typescript-eslint/no-deprecated': 'off',
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/return-await': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unnecessary-type-conversion': 'off',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-deprecated': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-useless-constructor': 'off',
      'no-control-regex': 'off',
      'no-useless-assignment': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='$queryRawUnsafe'], CallExpression[callee.property.name='$executeRawUnsafe'], Identifier[name='$queryRawUnsafe'], Identifier[name='$executeRawUnsafe']",
          message: 'Unsafe raw SQL is forbidden. Use tagged prisma.$queryRaw / $executeRaw templates.',
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/**/*.int.test.ts'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'writable',
        exports: 'writable',
        require: 'readonly',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
  {
    files: ['src/**/*.graphql.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/generated/prisma',
                '**/generated/prisma/**',
                '**/db',
                '**/db/**',
                '**/db/*',
              ],
              message: 'GraphQL resolvers must not import Prisma or src/db. Call a service.',
            },
          ],
        },
      ],
    },
  },
);
