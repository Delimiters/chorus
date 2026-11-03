# A plan row outlives the assignment it was added under

Jake, 2 November:

> "today she said she tried to assign watering to just her for upstairs plant
> and then also put water downstairs on today and I guess that wasn't working
> properly. Might be hard to diagnose without better details but idk maybe
> look into that"

It was diagnosable, from the data rather than from the description.

## What was actually wrong

An occurrence key does not encode who the chore belongs to. For everything but
an `everyone` fan-out it is `v1:{choreId}:{period}:{slot}:-`. So **reassigning a
chore does not change the key**, `planFor` goes on matching it, and a row the
automatic fill wrote on somebody's day while the chore was theirs stays there
after it stops being theirs.

Measured on the live household, running the real projector over the real rows:

```
TODAY rows=208 mismatched=1 occurrence-missing=153
  on JAKE's day: "Water Indoor Plants - Upstairs" assigned=member:EMILY due=2026-11-02
```

Exactly one, and exactly the one he described. The timestamps tell the rest:

```
JAKE  for=2026-11-02 addedBy=auto created=2026-11-02T13:25:53
EMILY for=2026-11-02 addedBy=auto created=2026-11-02T16:24:17
```

The fill added it to Jake at 13:25 while the chore was still his to do.
Somewhere after that Emily made it hers alone. Nothing was wrong with her
change — the stale row was simply never revisited.

## What `added_by` actually records

Worth stating precisely, because the fix leans on it and the name is slightly
misleading. `useAddToPlan` writes `ownerId ?? me` as the row's `user_id` and
`automatic ? null : userId` as its `added_by` — so when Jake adds something to
Emily's day, the stored `added_by` is **Emily's** id, not his.

That is harmless here, because this rule only asks null-or-not: did a person
decide, or did the fill.

It is **not** harmless for anything that tries to attribute the decision, and
one thing already does. `20260930090000_who_changed_your_day.sql` notifies you
when your housemate puts something on your day, guarded by
`if actor is null or actor = new.user_id then return new`. Since `added_by` is
written as `ownerId ?? me`, it *always* equals the row's `user_id` — so that
notification is structurally unreachable and has never fired. The removal path
gets it right and says so, storing `dismissedBy: userId` with the comment
"Whose day it came off is `owner`; this is who did it".

Outside this change and not fixed here, but it is the same field, so it is
written down rather than left to be rediscovered. Fixing it means writing the
actor rather than the owner into `added_by`, which this rule would not notice
and that trigger would.

## The rule, and the constraint that shapes it

The obvious fix is to drop anything on your day that is not yours. That is
wrong, and Jake had already said so, months before this:

> "I should be able to add it to my own plan even if it's assigned to emily"

Both have to be true at once. `added_by` already distinguishes them and was
being written but never read:

- **null — the fill chose it**, from an assumption about who the chore belonged
  to. When that assumption stops holding, the row has no reason to exist.
- **a person's id — a person chose it.** Helping with your housemate's chore is
  a thing people do, and a deliberate decision is not the app's to overrule.

So `dropReassignedAutoRows` keeps everything deliberate and drops only what the
fill added and the chore has since moved away from.

### Narrower than it first looked

The first implementation used `belongsTo`, and its own test caught what that
costs. A rotation with no segment covering the date resolves to `unassignable`,
which belongs to *nobody* — so `belongsTo` is false for both people and the row
would have been hidden from **everyone**. Work that exists and neither person
can see is a worse failure than the one being fixed.

It now drops a row only when the occurrence demonstrably belongs to somebody
else: `kind === 'member' && memberId !== ownerId`. `anyone` stays, `unassignable`
stays, and anything a future assignment kind produces stays by default.

### Four surfaces, one list

The rule has to be applied everywhere the plan is read, and "everywhere" was
larger than it looked. Each review round found another one:

| | |
|---|---|
| the rendered rows | `sectionsFor`, both days |
| the counts | `inPlanOrder` → `progress`, the header, the bar, the celebration, the empty-state gate |
| the housemate's counts | `useTheirPlanCount`, `useTheirPlanTotal` → `bothFinished` |
| **the widget and the lock screen** | `useWidget` → `widgetSnapshot`, `activityState` |

The widget was the last one found, and the most embarrassing: two of its test
fixtures carried a comment asserting *"the reassignment rule has already run by
then"* as the justification for hardcoding the field — written while it had not
run. A stranded row stayed in the widget's `totalCount`, so the home screen read
"5 of 6 done" for ever and could never say "Nothing left today", and if that
chore nagged, `activityState` put somebody else's chore on your lock screen with
nothing in the app able to clear it.

One predicate, `stillBelongsAfterReassignment`, is now shared by all four. It
was three inline copies for one round — identical by luck rather than by
construction, which is how three copies of a rule become two rules.

### One list, not two

The first version applied the rule in `sectionsFor` only. Review found that
`progress` — the "3 of 6" in the header, the bar, the celebration, and the gate
on the "Nothing planned yet" invitation — read a *separate*, unfiltered
`planFor` call. So a hidden row was still counted, `progress.finished` could
never become true, and a day whose only row was a stale one rendered a header
over an empty page with the invitation suppressed, because the count said one.

A row you cannot see and cannot tick must not be the thing standing between you
and the end of your day. There is now one filtered list and everything reads it.

The housemate's counts had the same split: `useTheirPlanCount` and
`useTheirPlanTotal` feed `bothFinished`, so a stranded row on their day — which
they cannot see or tick either — would have blocked the shared celebration for
ever, while the heading built from the filtered sections already said they had
finished. Both hooks apply the rule now.

### A display rule, not a deletion

Nothing is written. Same reasoning as `settle.ts`: a deleted row cannot come
back if the chore is reassigned again, or if this rule turns out to be wrong.
Hiding costs one render; deleting costs the ordering somebody built.

It also cannot fight the fill, because `autoPlannable` filters on `belongsTo`
too — the row being hidden is one the fill would never create today.

## The review round that caught a no-op

Worth recording, because it is the second time the same shape has cost a round.

`PlanEntry.addedBy` was declared **optional**. `useMyPlanEntries` — the only
source of `entries` for the plan screen — did not map it. tsc said nothing,
`dropReassignedAutoRows` read `undefined` for every row, treated it as "a
person chose this", and kept everything. **The fix was a no-op on the one day
the bug had ever been measured on.** The six mutation tests all passed because
every one of them ran inside a mocked seam that injected the field production
could not produce.

It is required now, which turns that omission into a type error, and
`useMyPlanEntries` has its first test. The general lesson, which this project
keeps paying for: an optional field defeats the compiler at exactly the moment
you are relying on the compiler, and a test that mocks the layer below cannot
see a layer that is not passing data up.

A second defect from the same round: `addedBy` was being looked up from the
entry list by occurrence key, across all eight fetched days. The same key
legitimately appears on several of them, entries arrive ordered by position
rather than date, and so an automatic row from last week could overrule a
deliberate one added today. `planFor` now carries the matched entry's
`addedBy` out on the row, because it is the only thing that knows which entry
won.

## Two things this diagnosis ruled out

Both were plausible, both were wrong, and both were killed by measurement
rather than by argument. Worth recording so they are not re-theorised:

- **Empty rotation rosters.** A first probe reported all eight rotations with
  an empty roster. The probe was reading `segment.roster`; the stored field is
  `segment.memberIds`. All eight are fine.
- **Rotations with no applicable segment.** Three rotations have an
  `effectiveFrom` of today or later, which would make earlier occurrences
  `unassignable`. Running the real projector over the real data:
  `UNASSIGNABLE: 0 occurrences across 0 chores`. Not happening.

## The other report, which the data says was already fixed

> "she said she archived dump pothos water multiple times yesterday and it
> still showed up on my plan today. Might have been before the fix."

"Dump Pothos Water" is archived in the database, at
`2026-11-02T03:40:06Z` — the evening of the 1st, local. It is a `once` chore,
and both `listChores` and `listOneTimeChores` filter `archived_at is null`, so
it produces no occurrence and `planFor` drops its rows. Confirmed: the live
projection contains none of it, and it renders `NOWHERE` for either person.

So the row was correct and Jake's phone was stale — which is the realtime
defect fixed in build 79, where a channel that failed to join left the phone
with no live updates at all and never retried. His own guess was right. Nothing
further to fix, and nothing to prove it with except that the data is now
consistent.

## Still unexplained, and worth watching

**153 of 208 plan rows for that day pointed at an occurrence that no longer
exists.** `planFor` drops them, so they are invisible rather than wrong, and the
behaviour is deliberate — a chore archived, rescheduled, or edited leaves its
rows behind. But three quarters of a day being dead rows is a lot of
accumulation, and it is why the plan renders far fewer rows than the table
holds. Not a bug as far as the screen is concerned; a tidy-up worth considering
if the table keeps growing, now that `plan_entries` has already passed 4,800
and caused one outage of its own.
