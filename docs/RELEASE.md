# Getting Chorus onto a phone

Written to be followed, not admired. Everything here needs either an Apple
Developer membership or a physical device, so none of it has been run — this is
a plan with its uncertainties marked, not a report.

## The constraint that shapes all of this

The dev machine is a 2018 Intel MacBook Pro on macOS Sequoia. macOS Tahoe
dropped every 2018 Mac, so **Xcode 26 can never be installed on it**, so SDK 55+
can never be compiled locally. There is no workaround and no upgrade path short
of new hardware.

Consequence: every native binary comes from **EAS cloud builds**. Day-to-day
development happens in Expo Go, which needs no compilation at all. This is why
the app avoids native modules it does not truly need — the date picker is built
from the app's own month grid rather than pulled from the community package, and
the bottom sheet is React Native's `Modal` rather than `@gorhom/bottom-sheet`.
Each avoided dependency is one fewer reason to spend a build.

**The free tier is 15 iOS builds a month.** Rebuild only when native
dependencies change; a JavaScript change is delivered by the bundle at launch.

## Before anything else

| What | Why | Cost |
|---|---|---|
| Expo account | EAS builds | free |
| Apple Developer Program | TestFlight, the App Store, and APNs | $99/yr |

Neither exists yet. Everything below the first section needs the second.

## A development build (no Apple account needed)

Enough to run the app on your own phone with native modules — which is the only
way to test **notifications**, the one part of this app that no test can stand
in for.

```bash
npm install -g eas-cli
eas login
eas build:configure          # eas.json is already committed; this links the project
eas build --platform ios --profile development
```

EAS will offer to create a free personal team provisioning profile. That is
enough for your own device; it is not enough to give the build to anybody else.

Install by scanning the QR code the build produces.

**Then run the five device checks in docs/ROADMAP.md.** The third is the one
that matters: completing a chore before its reminder must mean the reminder does
not arrive.

## TestFlight, so your partner can have it

Needs the $99 membership.

```bash
eas build --platform ios --profile production
eas submit --platform ios --latest
```

Then in App Store Connect: add your partner as an internal tester. Internal
testing needs no review and is usually available within the hour.

This is the realistic destination for this app. Two people sharing a household
do not need the App Store, and TestFlight avoids review entirely.

## The App Store, if it ever goes there

Beyond the build, review will want:

- **A privacy policy URL.** Non-negotiable, even for an app collecting almost
  nothing. What Chorus stores: an email address, a display name, and the chores
  themselves. No analytics, no third-party SDKs, no advertising identifier.
- **Privacy nutrition labels** — "Contact Info → Email Address", linked to
  identity, used for app functionality. Nothing else applies.
- **Screenshots** at the sizes App Store Connect currently asks for. Check
  rather than trust this document — the required set changes with the hardware.
- **An account deletion path.** Apple requires that an app offering account
  creation also offers deletion *in the app*. **This does not exist yet** and is
  the single largest gap between the current state and a submittable build. See
  below.

### Account deletion, unbuilt

Signing out is implemented; deleting an account is not. The schema is ready for
it — `on delete cascade` from `households` through everything — but the decision
it needs is a product one, not a technical one:

> When the last member of a household deletes their account, the household and
> every completion in it go with them. When a member leaves a shared household,
> their completions **must not**, or the other person's history acquires holes
> where the shared chores used to be.

That points at soft-deleting the membership and keeping the completion rows,
which is a schema change and a rethink of what `completed_by` means when the
person is gone. It deserves its own phase.

## Version numbering

`eas.json` sets `appVersionSource: remote` and `autoIncrement` on the production
profile, so build numbers are managed by EAS and cannot collide. The
user-visible version lives in `app.json`; bump it by hand when it means
something, which is rarely.

## Secrets

Only two, and neither is sensitive:

```
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Both are `EXPO_PUBLIC_`, so both are compiled into the bundle and readable by
anyone who downloads the app. That is fine and by design: the publishable key
grants nothing on its own, because every table is behind row-level security. The
key that would matter — the secret key — is **never** in the app, in CI, or in
this repository.

If a build ever needs a genuine secret, it goes in EAS secrets
(`eas secret:create`), never in `app.json`.

## What is not verified

Being explicit, because a release checklist that overstates its own confidence
is worse than none:

- **No native build has ever been produced.** `eas.json` is written but unrun.
- **No notification has ever fired.** The planner is pure and thoroughly tested;
  the delivery is not, and cannot be from this machine.
- **The Maestro flows have never run.** They are written against the real
  accessibility labels, and the YAML parses, but a flow is a guess until a
  device disagrees with it. Expect the first run to need fixing.
- **The nightly e2e workflow has never run**, and there is more wrong with it
  than "unrun" suggests. A retrospective found that its first version would have
  failed at the first step for at least four separate reasons — a build profile
  requiring dependencies this project does not have, an output filename that is
  not the format EAS produces, the Supabase variables set at test time when Expo
  inlines them at *build* time, and no Expo project link. All four are fixed,
  and none of the fixes has been run either.
- **There is no Expo project link.** `app.json` has no `extra.eas.projectId`, so
  `eas build --non-interactive` cannot proceed. `eas build:configure` writes it,
  and needs an Expo login — so it is the first thing to do, before anything else
  in this document.
