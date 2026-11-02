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

### A display rule, not a deletion

Nothing is written. Same reasoning as `settle.ts`: a deleted row cannot come
back if the chore is reassigned again, or if this rule turns out to be wrong.
Hiding costs one render; deleting costs the ordering somebody built.

It also cannot fight the fill, because `autoPlannable` filters on `belongsTo`
too — the row being hidden is one the fill would never create today.

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
