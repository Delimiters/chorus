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

**Time Sensitive, not critical.** `timeSensitive` breaks through Focus modes and
is the strongest level available without Apple's approval. `critical` also
overrides the silent switch, and is granted to medical, safety and home-security
apps; a chore app would not get it and should not ask. The entitlement
`com.apple.developer.usernotifications.time-sensitive` is declared in `app.json`.

**Audible only when asked.** Ordinary reminders stay exactly as they were —
silent, banner only. Marking everything Time Sensitive is the notification
equivalent of writing in capitals, and iOS lets the user switch the whole
category off in one tap.

**Rationed: three nagging chores per firing date.** `MAX_PENDING` is sixty
against the operating system's sixty-four, and the planner keeps the *soonest*
sixty. Three ladders is eighteen of the earliest slots; a fourth would start
pushing the rest of the week's reminders off the end of the queue, invisibly.
Past the ration a chore still gets its single ordinary reminder, so the feature
degrades rather than failing. The settings copy states the limit instead of
leaving somebody to discover it.

**Stopping is free.** `reconcile()` cancels every pending notification and
re-plans from current data on each change, so a ticked chore's remaining steps
are simply never planned again. No cancellation code, and nothing to leak.

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
- `ChoreForm.test.tsx` — off by default, saved when set, kept when reopened, and
  the copy saying what it actually does. That last one matters: a feature that
  promises an alarm and delivers a ladder is one people switch off the first
  morning it does less than they expected.

Every guard mutation-verified.

## What this is not

It will not wake you. It will not override the silent switch. If that is what is
wanted, the answer is AlarmKit above, and it is a real piece of work rather than
a flag.
