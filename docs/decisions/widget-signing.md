# Signing two targets without Xcode

The widget is a second target, and a second target means a second provisioning
profile. That turned out to be the awkward part, so it is written down here
rather than rediscovered.

## Why not the command line

```bash
xcodebuild … PROVISIONING_PROFILE_SPECIFIER="Chorus Dev"
```

applies one value to **every** target. The widget's bundle id is
`com.delimiters.chorus.widget`, which `Chorus Dev` does not match, so the
extension fails to sign. There is no per-target form of that flag.

## Why not a config plugin

Tried, and it cannot work from the plugin list.

`@bacons/apple-targets` adds the widget target through `withXcodeProjectBeta`,
its own base mod, which runs *after* the standard `ios.xcodeproj` phase. So an
ordinary `withXcodeProject` plugin sees a project containing only the app and
configures two build configurations instead of four — which it did, silently,
until the plugin was made to count them.

Registering in that later phase is refused outright:

```
PluginError: Cannot add mod to "ios.xcodeProjectBeta2" because the provider
has already been added. Provider must be the last mod added.
```

## What it does instead

`scripts/sign-targets.cjs`, run after prebuild on the finished project, sets
`CODE_SIGN_STYLE = Manual` and the right `PROVISIONING_PROFILE_SPECIFIER` per
bundle id. `npm run ios:prebuild` chains prebuild → sign-targets → `pod install`,
and that is the command `docs/RELEASE.md` tells you to run.

It **exits non-zero unless it configures exactly four** build configurations —
two targets, Debug and Release each — and prints every bundle id it found when
it does not. The alternative is xcodebuild's version of the same mistake:
`No Accounts: Add a new account in Accounts settings`, twenty minutes in,
naming neither the target nor the cause. That error cost a day once already.

A bare `npx expo prebuild` leaves automatic signing in place and the build then
fails that way. The guard is in the script rather than the build because by the
time xcodebuild runs, the useful information — which target, which bundle id —
is gone.

## Verified

Build 65, `generic/platform=iOS`, Release:

```
Chorus.app                        embedded profile: Chorus Dev
  entitlements: aps-environment, usernotifications.time-sensitive,
                application-groups [group.com.delimiters.chorus]
Chorus.app/PlugIns/ChorusWidget.appex   embedded profile: Chorus Widget Dev
  entitlements: application-groups [group.com.delimiters.chorus]
```

Both carry the same group, which is the one identifier they have to agree about
— and the reason the widget would otherwise have read nothing: the App Groups
capability was enabled on both App IDs all along with an **empty** array, so
`containerURL(forSecurityApplicationGroupIdentifier:)` returned nil with no
error anywhere. See the signing section of `docs/WHERE-THINGS-STAND.md`.

## Shipped

`modules/widget-bridge` is the native module this section used to say was
missing, and `docs/decisions/the-widget-and-the-card.md` describes it. The
widget and the Live Activity both work as of build 67.
