#!/usr/bin/env node
/**
 * Points each target in the generated Xcode project at a provisioning profile
 * made by hand.
 *
 * ── Why this exists at all ──────────────────────────────────────────────────
 *
 * Automatic signing needs an Apple ID signed into Xcode to mint profiles, and
 * signing one in has twice minted a second development certificate that the
 * existing profile did not carry, which breaks local signing until the Apple ID
 * password is re-entered. Apple allows two certificates per account and both
 * slots are used, so a third would mean revoking one. The signing section of
 * docs/WHERE-THINGS-STAND.md has the whole story.
 *
 * ── Why a script and not a config plugin ────────────────────────────────────
 *
 * Tried, twice, and neither works:
 *
 *  - `xcodebuild PROVISIONING_PROFILE_SPECIFIER=…` on the command line applies
 *    one value to *every* target. The widget's bundle id is
 *    `com.delimiters.chorus.widget`, which the app's profile does not match.
 *  - A `withXcodeProject` config plugin runs in the standard `ios.xcodeproj`
 *    mod phase, which happens *before* `@bacons/apple-targets` adds the widget
 *    target through its own later base mod — so the plugin sees a project with
 *    only the app in it and configures two build configurations instead of
 *    four. Registering in that later phase is refused outright:
 *    "Cannot add mod to ios.xcodeProjectBeta2 because the provider has already
 *    been added. Provider must be the last mod added."
 *
 * So this runs after prebuild, on the finished project. `npm run ios:prebuild`
 * does both, which is what docs/RELEASE.md tells you to run; a bare
 * `npx expo prebuild` leaves automatic signing in place and the build then
 * fails with "No Accounts: Add a new account in Accounts settings".
 */
const path = require('node:path');
const xcode = require('xcode');

const PROFILES = {
  'com.delimiters.chorus': 'Chorus Dev',
  'com.delimiters.chorus.widget': 'Chorus Widget Dev',
};
const TEAM = 'SY59JGZ44Y';
const EXPECTED = 4; // two targets, Debug and Release each

const projectPath = path.join(__dirname, '..', 'ios', 'Chorus.xcodeproj', 'project.pbxproj');
const project = xcode.project(projectPath);
project.parseSync();

const configurations = project.pbxXCBuildConfigurationSection();
const applied = [];
const seen = new Set();

for (const key of Object.keys(configurations)) {
  const settings = configurations[key]?.buildSettings;
  if (!settings) continue;

  // Bundle ids arrive quoted or bare; the quotes belong to the pbxproj string.
  const bundleId = String(settings.PRODUCT_BUNDLE_IDENTIFIER ?? '').replace(/^"|"$/g, '');
  if (!bundleId) continue;
  seen.add(bundleId);

  const profile = PROFILES[bundleId];
  if (!profile) continue;

  settings.CODE_SIGN_STYLE = 'Manual';
  settings.PROVISIONING_PROFILE_SPECIFIER = `"${profile}"`;
  settings.DEVELOPMENT_TEAM = TEAM;
  applied.push(`${bundleId} ${configurations[key].name}`);
}

/*
 * Fail here rather than letting the build fail. xcodebuild's version of this
 * mistake is "No Accounts: Add a new account in Accounts settings" twenty
 * minutes in, naming neither the target nor the cause — and that error cost a
 * day once already.
 */
if (applied.length !== EXPECTED) {
  console.error(
    `sign-targets: configured ${applied.length} build configurations, expected ${EXPECTED}.\n` +
      `  wanted: ${Object.keys(PROFILES).join(', ')}\n` +
      `  found in project: ${[...seen].sort().join(', ') || '(none)'}\n` +
      `Has a bundle identifier changed, or did prebuild skip the widget target?`,
  );
  process.exit(1);
}

require('node:fs').writeFileSync(projectPath, project.writeSync());
console.log(`sign-targets: manual signing on ${applied.join(', ')}`);
