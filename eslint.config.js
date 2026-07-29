// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier/flat');

/**
 * Packages `src/core/**` may never import.
 *
 * This is the load-bearing rule of the whole architecture. `src/core` is the
 * scheduling engine: pure, synchronous, dependency-free, and therefore testable
 * to exhaustion in milliseconds under plain Node with no preset, no mocks, and
 * no renderer. The moment it can import React or Supabase, that property dies
 * and the 95% coverage target stops being achievable.
 *
 * See docs/ARCHITECTURE.md and docs/decisions/ADR-0001.
 */
const CORE_FORBIDDEN_PACKAGES = [
  'react',
  'react-dom',
  'react-native',
  'react-native/*',
  'react-native-*',
  'expo',
  'expo-*',
  '@expo/*',
  '@react-native/*',
  '@react-native-async-storage/*',
  '@supabase/*',
  '@tanstack/*',
  'zustand',
  'zustand/*',
];

/** Sibling layers `src/core/**` may never reach into. */
const CORE_FORBIDDEN_LAYERS = [
  '@/data',
  '@/data/*',
  '@/design',
  '@/design/*',
  '@/features',
  '@/features/*',
  '@/app',
  '@/app/*',
  '**/data/**',
  '**/design/**',
  '**/features/**',
];

module.exports = defineConfig([
  expoConfig,
  prettier,
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*', 'coverage/*', 'build/*'],
  },

  // ── The purity boundary ────────────────────────────────────────────────────
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: CORE_FORBIDDEN_PACKAGES,
              message:
                'src/core must stay pure — no React, Expo, Supabase, or state libraries. ' +
                'It is plain TypeScript so it can be tested without a renderer. See docs/ARCHITECTURE.md.',
            },
            {
              group: CORE_FORBIDDEN_LAYERS,
              message:
                'src/core must not depend on outer layers. Dependencies point inward: ' +
                'app -> features -> data -> core. See docs/ARCHITECTURE.md.',
            },
          ],
        },
      ],

      // Due dates are civil dates ('YYYY-MM-DD'), never instants. `Date` in the
      // engine is how the Swift prototype got Feb-31 and Sunday-hardcoding bugs.
      // "Today" is computed once at the edge and injected as a parameter.
      // See docs/RECURRENCE.md "Timezone strategy".
      'no-restricted-globals': [
        'error',
        {
          name: 'Date',
          message:
            'src/core is Date-free by design. Use CivilDate string arithmetic from @/core/civil/date. ' +
            'Pass "today" in as a parameter instead of reading a clock. See docs/RECURRENCE.md.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message:
            'src/core is Date-free by design. Use CivilDate arithmetic from @/core/civil/date.',
        },
        {
          selector: "MemberExpression[object.name='Date']",
          message:
            'src/core is Date-free by design (no Date.now()). Pass "today" in as a parameter.',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'src/core must be deterministic — no Math.random().',
        },
      ],
    },
  },

  // Tests may use Date to construct fixtures/expectations.
  {
    files: ['src/core/**/*.test.ts', 'src/core/**/__testing__/**/*.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-syntax': 'off',
      // `import fc from 'fast-check'` then `fc.assert(...)` is the documented
      // usage; the rule mistakes every namespace member for a default-export slip.
      'import/no-named-as-default-member': 'off',
    },
  },

  // ── Integration tests: the service-role guard ──────────────────────────────
  // RLS tests that assert with an admin client pass while proving nothing.
  // See docs/TESTING.md.
  {
    files: ['test/integration/**/*.ts'],
    rules: {
      // This code runs in plain Node against a local Postgres, not in the app
      // bundle, so Expo's build-time env inlining doesn't apply.
      'expo/no-dynamic-env-var': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='expect'] MemberExpression[object.name='admin']",
          message:
            'Never assert against the service-role client — it bypasses RLS, so the test proves nothing. ' +
            'Use the alice/bob clients. Admin is for setup and teardown only. See docs/TESTING.md.',
        },
      ],
    },
  },
]);
