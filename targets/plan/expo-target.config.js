/**
 * The home-screen widget target.
 *
 * Generated into the Xcode project by `@bacons/apple-targets` during
 * `expo prebuild`, which is the whole reason for the plugin: `ios/` is
 * gitignored and regenerated on every build here, so a target added by hand in
 * Xcode would be wiped the next time anybody built the app. Everything under
 * `targets/` survives, is committed, and is relinked each time.
 *
 * The App Group is not declared here. The plugin mirrors
 * `ios.entitlements['com.apple.security.application-groups']` from app.json
 * onto targets that can use one, so the app and the widget cannot drift apart
 * on the one identifier they both have to agree about.
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: 'widget',

  /*
   * Empty on purpose, and required.
   *
   * The plugin mirrors the app's App Group into a generated entitlements file
   * — but only writes that file at all when this object exists. Leaving it out
   * built cleanly and produced a widget with no group, so
   * `containerURL(forSecurityApplicationGroupIdentifier:)` returned nil and it
   * read nothing, forever, with no error anywhere. The one identifier stays in
   * app.json so the app and the widget cannot drift apart on it.
   */
  entitlements: {},

  name: 'ChorusWidget',
  displayName: 'Chorus',
  colors: {
    // The two people, and the paper they sit on. Same values as
    // src/design/tokens.ts — a widget that drifted from the app's grounds
    // would undo the one thing the palette is for.
    //
    // Only the grounds live here. A *person's* ink is per member and arrives
    // on each row of the snapshot, both variants, because an asset catalogue
    // cannot hold a value that depends on who the chore belongs to. The two
    // brand inks used to be declared here and referenced by nothing, which
    // read as if they were what the rows were drawn in.
    $paper: { color: '#F3F2EE', darkColor: '#121219' },
    $text: { color: '#17171F', darkColor: '#ECEBE6' },
    $textFaint: { color: '#7C7C86', darkColor: '#76757F' },
    $overprint: { color: '#5B2E9E', darkColor: '#B08CFF' },
  },
};
