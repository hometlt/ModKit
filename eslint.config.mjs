// Lint skeleton (X3-S0.0). Rules tighten in S0.1 when the first package lands;
// the legacy-vocabulary gate is deliberately NOT an eslint rule — it is the separate
// scripts/check-legacy.mjs so it also covers JSON schemas and package manifests.
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      // gate regression fixtures intentionally contain forbidden/legacy shapes
      'scripts/test/fixtures/**',
    ],
  },
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    files: ['packages/*/src/**/*.ts'],
    rules: {
      // canon §14.9: library code uses a logger, never raw console
      'no-console': 'error',
    },
  },
)
