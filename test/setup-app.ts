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

export {};
