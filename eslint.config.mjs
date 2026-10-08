// @ts-check
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const restrict = (message, ...group) => ({
  'no-restricted-imports': ['error', { patterns: [{ group, message }] }],
});

const layer = (name) => [`**/${name}`, `**/${name}/**`];

export default defineConfig(
  {
    ignores: ['dist/**', 'coverage/**', 'reports/**', '.stryker-tmp/**', 'node_modules/**'],
  },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['test/**/*.ts'],
    languageOptions: { globals: { ...globals.jest } },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // Layer rules: dependencies point inwards to a framework-free domain.
  {
    files: ['src/domain/**/*.ts'],
    rules: restrict(
      'Domain is pure TypeScript plus luxon: no framework, database or other layer imports.',
      '@nestjs/*',
      'kysely',
      'kysely/*',
      'pg',
      'pg/*',
      ...layer('application'),
      ...layer('infrastructure'),
      ...layer('api'),
      ...layer('config'),
    ),
  },
  {
    files: ['src/application/**/*.ts'],
    rules: restrict(
      'Application may import the domain, its ports and @nestjs/common only.',
      'kysely',
      'kysely/*',
      'pg',
      'pg/*',
      ...layer('infrastructure'),
      ...layer('api'),
    ),
  },
  {
    files: ['src/infrastructure/**/*.ts'],
    rules: restrict('Infrastructure must not import the API layer.', ...layer('api')),
  },
  {
    files: ['src/api/**/*.ts'],
    rules: restrict(
      'The API layer talks to the application layer, never to the database or infrastructure.',
      'kysely',
      'kysely/*',
      'pg',
      'pg/*',
      ...layer('infrastructure'),
    ),
  },
);
