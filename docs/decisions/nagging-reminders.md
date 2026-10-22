# A chore that keeps asking

**20 October 2026.** Jake: *"Can we make some kind of feature for a super
notification? Like where it vibrates continuously or acts like an alarm or sends
repeated notifications until it's done?"* — and *"You can also research online
for how other apps like alarmy and whatnot do these kinds of things."*

Three things were asked for. iOS allows one of them outright, one with a native
framework, and one not at all.

## What iOS actually permits

**Continuous vibration: no.** A local notification plays one sound and one
haptic. There is no "buzz until dismissed" API for third-party apps, and nothing
in `expo-notifications` or `UNNotificationRequest` exposes one. Every app that
appears to do it is playing a sequence.

**A true alarm: yes, via AlarmKit — and not in this change.** iOS 26 added
`AlarmKit`, which gives a third-party app the Clock app's standing: full-screen
alert, audible **through Silent mode and Focus**, ringing until somebody stops
it, with Lock Screen and Dynamic Island presence. Both phones here are on 26.6,
so it is available to this household today.

It needs: a Swift module, `NSAlarmKitUsageDescription` in `Info.plist`, a runtime
`AlarmManager.shared.requestAuthorization()` prompt, and a widget extension —
the Live Activity metadata types have to be identical across the app and the
extension target. Notably it needs **no entitlement from Apple**, which is the
usual blocker for this kind of thing. Practical gotchas worth keeping: the
concurrent-alarm limit is undocumented (one shipping app caps at 30 and says how
many it dropped rather than silently omitting them), alarm ids must be
deterministic so a rescan does not duplicate them, and a fired alarm must never
be cancelled.

That is a native integration of the same size as the widget work, and it asks
the user for a new permission. It is the right answer to "acts like an alarm" and
it is a separate piece. Noted here so the next person does not re-derive it.

**Repeated notifications until it is done: yes, now.** That is this change.

## What was built

A per-chore switch — *"Keep reminding me until it's done"* — and a widening
ladder of reminders behind it.

**Widening, not a metronome.** Every two minutes for half an hour is fifteen
identical buzzes, which trains you to swipe without reading. That is the failure
this entire notification layer is written against — it is why ordinary reminders
are silent, why `includeUnassigned` defaults off, and why the body text is plain.
So the gaps grow: **0, 3, 8, 16, 27, 40 minutes**. Close together while you have
just been asked, further apart once it is clear you are busy, and finished at
forty — a nag still going an hour later has stopped being a reminder and become
the reason somebody turns the app off.

**Time Sensitive, not critical.** The ladder makes a sound and asks for
`interruptionLevel: 'timeSensitive'`, which breaks through a Focus mode and is
the strongest level available without Apple's approval. `critical`, which also
overrides the silent switch, is granted to medical, safety and home-security
apps; a chore app would not get it and should not ask. The entitlement
`com.apple.developer.usernotifications.time-sensitive` is declared in
`app.json`.

### Getting the profile to carry it — a day's detour, written down

Build 63 failed. The entitlement reached the generated entitlements file
correctly, and then signing refused it:

```
error: No Accounts: Add a new account in Accounts settings.
error: Provisioning profile "iOS Team Provisioning Profile: com.delimiters.chorus"
       doesn't support the Time Sensitive Notifications capability.
```

**Adding a capability invalidates every profile that includes the App ID.**
Builds 49–62 signed fine on a cached Xcode-managed profile; the moment a
capability changed, a new profile was needed, and Xcode mints those only with an
Apple ID signed into it. There was none, and Xcode's cached team record still
read `isFreeProvisioningTeam = 1` / "Personal Team" despite the membership being
paid since September.

The fix was to stop asking Xcode for profiles at all:

1. In the portal (Certificates, Identifiers & Profiles), Identifiers → App
   Groups → register `group.com.delimiters.chorus`, then attach it to both
   `com.delimiters.chorus` and `com.delimiters.chorus.widget` — the capability
   was already enabled on both App IDs, with an **empty** group array, which is
   why the widget read nothing.
2. On `com.delimiters.chorus`, tick **Time Sensitive Notifications**.
3. *Then* — and only after every capability edit, since each one invalidates
   again — Profiles → + → iOS App Development, one profile per App ID, with
   **both** development certificates and both devices selected.
4. Install them under their UUIDs in
   `~/Library/Developer/Xcode/UserData/Provisioning Profiles` and
   `~/Library/MobileDevice/Provisioning Profiles`, and build with
   `CODE_SIGN_STYLE=Manual` + `PROVISIONING_PROFILE_SPECIFIER`.

**Why manual rather than signing into Xcode:** signing in has previously minted
a second development certificate that the existing profile did not carry, which
breaks local signing until the Apple ID password is re-entered. Two certificates
are now on this machine from that episode, and Apple allows only two — a third
would mean revoking one. Hand-made profiles name the certificates they trust, so
both are included and whichever signs will match.

The profiles expire **2027-10-22**. When they do, the same four steps apply;
nothing about them needs Xcode.

**Audible only when asked.** Ordinary reminders stay exactly as they were —
silent, banner only. Marking everything Time Sensitive is the notification
equivalent of writing in capitals, and iOS lets the user switch the whole
category off in one tap.

**The earliest reminder time only.** A chore may name four times; the ladder
takes the first. The first version laddered every time, which a review measured
at twenty-four notifications for one chore — forty per cent of the whole queue —
and put two audible notifications in the same minute when two times were three
minutes apart. "Keep reminding me until it's done" is one conversation that
starts when the chore comes due, not six because the chore names four times.

**Rationed: three nagging chores per firing date.** `MAX_PENDING` is sixty
against the operating system's sixty-four, and the planner keeps the *soonest*
sixty. Three ladders is eighteen of the earliest slots; a fourth would start
pushing the rest of the week's reminders off the end of the queue, invisibly.
Past the ration a chore still gets its single ordinary reminder, so the feature
degrades rather than failing. The settings copy states the limit instead of
leaving somebody to discover it.

Counted against the date each step *fires* on, and in whole ladders. Keyed on
the due date it was wrong twice: under the 3 AM break a 01:00 reminder fires the
next calendar day, so two rations landed on one wall-clock date — thirty-six
insistent notifications where the cap says eighteen, measured. And a ladder
starting at 23:50 spilled its later steps onto the next date without paying for
them there. A first attempt charged a sixth of a ladder per step so a spilling
ladder paid proportionally; six sixths is 0.999… in floating point, three ladders
summed to just under three, and a fourth slipped through — the ration failing
silently, which is exactly what it exists to prevent.

**Stopping is not free, and the copy says so.** `reconcile()` cancels every
pending notification and re-plans from current data — but it only runs when this
app renders, and it cannot run while the phone is asleep in a pocket. A review
found the honest failure: the bins reminder fires at 07:00, Emily takes them out
and ticks it on *her* phone at 07:02, and Jake's phone — locked, its queue
untouched — still nudges him at 07:03, 07:08, 07:16, 07:27 and 07:40 about a job
finished thirty-eight minutes ago. With sound, through Focus. That is the
"teaches you to swipe without reading" failure this file is written against, with
sound attached.

Nothing fixes it properly without a push to the other device. The exposure is
bounded by the ladder's own length — forty minutes — and the form says plainly
that ticking it off stops the rest *next time this phone opens the app*. A
notification action that writes the completion from the lock screen would
shorten it further and is the obvious next step if this proves annoying.

## The flag is on the chore

Not on the household, and not per person. It is a property of the job — the bins
go out tonight or not for a week — and the two of them share the job. A personal
switch would mean one being nagged about something the other had quietly
silenced. Either housemate can change it, which `nag-until-done.test.sql`
asserts.

## Pinned by

- `core/notify/insist.test.ts` — the ladder's shape, that the gaps widen and are
  all distinct, that a nag starting at 23:50 rolls onto the next date rather than
  producing `24:30`, which the engine's own time parser rejects, and that the
  ration times the ladder length stays under twenty slots.
- `core/notify/plan.test.ts` — a ladder only when asked for, every step with its
  own identifier (two sharing one are one notification, and the chore would ask
  once and go quiet), the first step keeping the original id so a pending
  reminder is updated rather than duplicated, the fourth nagging chore of a day
  falling back to one reminder, and the overall cap still holding.
- `data/notifications.test.ts` — what actually reaches the operating system:
  `sound` and `timeSensitive` on a nagging reminder, neither on an ordinary one.
- `ChoreForm.test.tsx` — off by default, saved when set, kept when reopened, not
  offered on a Someday chore (which can never remind), and the copy saying what
  it actually does. That last one matters: a feature that
  promises an alarm and delivers a ladder is one people switch off the first
  morning it does less than they expected.

Every guard mutation-verified — including, after a review, the two that were
not. The ration test used five occurrences sharing one due date, so it could not
tell "three per date" from "three per plan": replacing the map with a single
global counter left all sixty-six tests green. And the transport change — the one
line that makes any of this audible — had no test at all; stripping both `sound`
and `interruptionLevel` left 293 tests green. Both are now covered, and both
mutations fail.

## What this is not

It will not wake you. It will not override the silent switch. If that is what is
wanted, the answer is AlarmKit above, and it is a real piece of work rather than
a flag.
