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
  /*
   * ── `light`/`dark`, NOT `color`/`darkColor` ────────────────────────────────
   *
   * The plugin's own type documentation says
   * `colors: { gradient1: { color: "#FF0000", darkColor: "#0000FF" } }`.
   * Its code does not: `with-widget.js` reads `color.light` and `color.dark`
   * and passes them on. Given the documented shape, both come out `undefined`
   * and it writes `{ "colors": [] }` — a colorset with no colours in it, with
   * no warning from the plugin, the prebuild or the build.
   *
   * `Color("$paper")` then resolves to nothing. The widget rendered blank and
   * the Live Activity came up as a semi-transparent card with the app's name
   * and no content, because the background and every piece of text were
   * invisible. Jake, on build 67: *"when i added the widget it was just
   * blank"*.
   *
   * `src/core/widget/colors.test.ts` reads the generated Contents.json and
   * fails if any colorset is empty or drifts from `src/design/tokens.ts`.
   */
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
    $paper: { light: '#F3F2EE', dark: '#121219' },
    $text: { light: '#17171F', dark: '#ECEBE6' },
    $textFaint: { light: '#7C7C86', dark: '#76757F' },
    $overprint: { light: '#5B2E9E', dark: '#B08CFF' },
  },
};
