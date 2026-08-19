// Lint skeleton (X3-S0.0). Rules tighten in S0.1 when the first package lands;
// the legacy-vocabulary gate is deliberately NOT an eslint rule — it is the separate
// scripts/check-legacy.mjs so it also covers JSON schemas and package manifests.
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      // agent worktrees: copies of this repository that run their own gates
      '.claude/**',
      '**/dist/**',
      // bundled application output, not authored source
      '**/dist-app/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      '**/validators.generated.ts',
      '**/validators.generated/**',
      // gate regression fixtures intentionally contain forbidden/legacy shapes
      'scripts/test/fixtures/**',
      // external UI mockup drop (Nexus IDE `.dc.html` + support scripts): not lab source, not
      // authored against these rules; kept out of lint/format until it gets a real home
      'NexusForgeUI/**',
    ],
  },
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    // Electron loads its main and preload entry points as CommonJS; `require` is the contract
    // there, not a style choice.
    files: ['apps/electron/electron/**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  {
    files: ['packages/*/src/**/*.ts'],
    rules: {
      // canon §14.9: library code uses a logger, never raw console
      'no-console': 'error',
    },
  },
)
