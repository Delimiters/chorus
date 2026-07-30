// Route wrapper. The screen lives in src/features so its test file is not
// inside the router tree — anything under src/app is treated as a route,
// which put `expect` into the app bundle and broke the web build.
export { CreateHouseholdScreen as default } from '@/features/onboarding/CreateHouseholdScreen';
