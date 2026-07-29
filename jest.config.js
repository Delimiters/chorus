/**
 * Three independent test projects with very different needs.
 *
 * `core` deliberately does NOT use the jest-expo preset. The scheduling engine
 * is plain TypeScript, so it runs in plain Node in about a second — which is
 * what makes a 95% coverage gate practical rather than aspirational. Adding the
 * preset here would slow it by an order of magnitude for zero benefit.
 *
 * See docs/TESTING.md.
 */
const coverageThreshold = { branches: 95, functions: 100, lines: 95, statements: 95 };

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: 'core',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/core/**/*.test.ts'],
      transform: {
        '^.+\\.tsx?$': [
          'babel-jest',
          { presets: [['babel-preset-expo', { jsxRuntime: 'automatic' }]] },
        ],
      },
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
    },
    {
      displayName: 'app',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/src/**/*.test.tsx', '<rootDir>/src/**/*.test.native.ts'],
      setupFilesAfterEnv: ['<rootDir>/test/setup-app.ts'],
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/integration/**/*.test.ts'],
      transform: {
        '^.+\\.tsx?$': [
          'babel-jest',
          { presets: [['babel-preset-expo', { jsxRuntime: 'automatic' }]] },
        ],
      },
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
      // Integration tests talk to a real Postgres; jest.setTimeout is applied
      // in test/integration/setup.ts rather than here (project configs reject it).
    },
  ],

  // Coverage is collected across projects; the gates that matter are the
  // per-directory ones on the engine.
  collectCoverageFrom: [
    'src/core/**/*.ts',
    '!src/core/**/*.test.ts',
    '!src/core/**/__testing__/**',
    '!src/core/**/__fixtures__/**',
  ],
  coverageThreshold: {
    'src/core/civil/': coverageThreshold,
    'src/core/recurrence/': coverageThreshold,
    'src/core/rotation/': coverageThreshold,
    'src/core/occurrence/': coverageThreshold,
  },
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
};
