/**
 * Setup for the `app` (component) test project.
 *
 * @testing-library/react-native v12.4+ registers its jest matchers
 * automatically, so there is nothing to import for those. RNTL v14 is async:
 * `render`, `fireEvent` and `renderHook` all return promises and must be
 * awaited. See docs/TESTING.md.
 */

// Any module that reaches the Supabase client transitively imports env
// validation, which throws when unset. Tests never make real requests, but they
// do need the module to load — so provide placeholders rather than requiring a
// developer's .env.local to exist.
process.env.EXPO_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'sb_publishable_test';

/**
 * Jest's default 5s was never a decision anybody made about this preset.
 *
 * The *first* test in a component file pays the whole jest-expo module-init and
 * first-render cost — about 275ms on the dev machine, past 5s on a loaded CI
 * runner, which failed exactly one test of 175: the first one in the largest
 * file. The work is real, not a hang, so the limit is raised rather than the
 * test worked around.
 *
 * It lives here and not in `jest.config.js` because **project configs silently
 * ignore `testTimeout`** — setting it there looked like a fix, passed review by
 * my own eyes, and changed nothing. The integration project already discovered
 * this; the comment there says so.
 */
jest.setTimeout(20_000);

/**
 * `expo-notifications` is mocked for every component test.
 *
 * Importing it for real runs `DevicePushTokenAutoRegistration.fx`, which
 * registers a listener at module load. Nothing unregisters it, so the Jest
 * worker never exits and the *suite* fails with every test passing — which is
 * exactly how it presented in CI: "1 failed, 17 passed" over "225 passed".
 *
 * Nothing here should be reaching a real notification API anyway. The planning
 * logic is pure and tested in `src/core/notify`; the only thing worth testing
 * on this side is `fireAt`, which is arithmetic.
 */
/**
 * AsyncStorage has no native module in a test environment, and importing it
 * throws on load — which surfaces as a *suite* failure with every test in it
 * passing, since nothing ever ran. The package ships a mock for exactly this.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
  setNotificationHandler: jest.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

export {};
