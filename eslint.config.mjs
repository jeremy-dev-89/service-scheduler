// @ts-check
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Packages by name; our own layers by relative path, e.g. '../infrastructure/x'. */
const restrict = (message, { packages = [], layers = [] }) => ({
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        ...(packages.length > 0 ? [{ group: packages, message }] : []),
        ...layers.map((name) => ({ regex: `^\\.{1,2}/(.+/)?${name}(/.*)?$`, message })),
      ],
    },
  ],
});

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
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },

  // Layer rules: dependencies point inwards to a framework-free domain.
  {
    files: ['src/domain/**/*.ts'],
    rules: restrict(
      'Domain is pure TypeScript plus luxon: no framework, database or other layer imports.',
      {
        packages: ['@nestjs/*', 'kysely', 'kysely/*', 'pg', 'pg/*'],
        layers: ['application', 'infrastructure', 'api', 'config'],
      },
    ),
  },
  {
    files: ['src/application/**/*.ts'],
    rules: restrict('Application may import the domain, its ports and @nestjs/common only.', {
      packages: ['kysely', 'kysely/*', 'pg', 'pg/*'],
      layers: ['infrastructure', 'api'],
    }),
  },
  {
    files: ['src/infrastructure/**/*.ts'],
    rules: restrict('Infrastructure must not import the API layer.', { layers: ['api'] }),
  },
  {
    files: ['src/api/**/*.ts'],
    rules: restrict(
      'The API layer talks to the application layer, never to the database or infrastructure.',
      { packages: ['kysely', 'kysely/*', 'pg', 'pg/*'], layers: ['infrastructure'] },
    ),
  },
);
