/*
 * A routine item that keeps asking until it is done.
 *
 * Jake: *"we should implement the super notification stuff we have for the
 * chores for routines as well"*.
 *
 * The same switch as `chores.nag_until_done`, and the same reasoning about
 * defaults — off, because a reminder that breaks through Focus is a privilege a
 * thing has to be given, and a day that nagged about all of it would end with
 * the app's notifications turned off.
 *
 * One difference worth naming. A chore is shared, so its nag flag is a property
 * of the job. **A routine item belongs to one person**, so this is per person
 * by construction: it sits on a row that only its owner may write, which is
 * what `routine_items`'s own policies already enforce. Nobody can switch on
 * nagging for somebody else's morning.
 *
 * It applies only where there is a moment to nag *about*. An item with a bucket
 * rather than a time says "sometime this morning", and its reminder is one
 * grouped nudge shared with everything else in that bucket — there is no
 * instant for a ladder to climb from, and laddering a shared notification would
 * nag about items that were already done. The planner therefore ignores this
 * flag unless `time_of_day` is set, and the form hides the switch then. The
 * column stays simple rather than carrying a CHECK, so that turning a bucket
 * item into a timed one keeps whatever you had chosen.
 *
 * As with chores, the *behaviour* is entirely on the device: each phone plans
 * its own local notifications from this flag (`core/notify/insist.ts`), capped
 * against iOS's sixty-four pending limit. Nothing about the ladder is stored.
 */

alter table public.routine_items
  add column nag_until_done boolean not null default false;

comment on column public.routine_items.nag_until_done is
  'Keep reminding the owner until this routine item is ticked off, instead of once. Only honoured for items with a specific time_of_day: a bucket item shares one grouped reminder and has no instant to ladder from.';
