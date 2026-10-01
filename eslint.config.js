// Undefined-name check, run by `npm run lint:undef` (and before `npm test`).
// It only catches names that are used but never defined or imported, which
// throw a ReferenceError only when that code path runs. No style rules.
import globals from 'globals';
import importPlugin from 'eslint-plugin-import';

export default [
  {
    // ESLint does not read .gitignore, so mirror the parts that hold JS.
    ignores: [
      '**/node_modules/**',
      'logs/**',
      'coverage/**',
      'uploads/**',
      '.superpowers/**',
      '.claude/*',
      '!.claude/skills/'
    ]
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      // ES modules: no require/module/exports/__dirname/__filename.
      globals: { ...globals.nodeBuiltin, ...globals.es2024 }
    },
    plugins: { import: importPlugin },
    settings: {
      'import/resolver': {
        node: { extensions: ['.js', '.mjs', '.cjs', '.json'] }
      },
      // Only check our own files. Most packages are CommonJS, so checking
      // their exports gives false results (e.g. the default import of xlsx).
      'import/ignore': ['node_modules']
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-undef': 'error',
      'import/named': 'error'
    }
  },
  {
    files: ['**/*.cjs', 'migrations/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.es2024 }
    },
    rules: { 'no-undef': 'error' }
  },
  {
    // Jest runs these through Babel, so CommonJS names are also available.
    files: ['tests/**', 'jest/**'],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2024, ...globals.jest }
    }
  }
];
