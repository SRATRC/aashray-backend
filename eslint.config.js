// Undefined-name check, run by `npm run lint:undef` (and before `npm test`).
// It only catches names that are used but never defined or imported, which
// throw a ReferenceError only when that code path runs. No style rules.
// A wrong name in a static import needs no rule: ES modules refuse to load,
// so the server fails at start-up.
import globals from 'globals';

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
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: { 'no-undef': 'error' }
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
