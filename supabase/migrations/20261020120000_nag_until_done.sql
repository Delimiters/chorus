/*
 * A chore that keeps asking until it is done.
 *
 * Jake: *"Can we make some kind of feature for a super notification? Like where
 * it vibrates continuously or acts like an alarm or sends repeated
 * notifications until it's done?"*
 *
 * Per chore, not per household and not per person: it is a property of the
 * job — the bins go out tonight or they do not go out for a week — and the two
 * people share the chore. A personal switch would mean one of them being
 * nagged about a job the other had quietly turned the nagging off for.
 *
 * Default false, deliberately. A reminder that breaks through Focus is a
 * privilege the chore has to be given, and a household that woke up to every
 * chore nagging would turn the app's notifications off inside a day — which
 * costs them the ordinary reminders too.
 *
 * The *behaviour* lives on the device: each phone plans its own local
 * notifications from this flag (`core/notify/insist.ts`), capped against iOS's
 * sixty-four pending limit. Nothing about the ladder is stored.
 */

alter table public.chores
  add column nag_until_done boolean not null default false;

comment on column public.chores.nag_until_done is
  'Keep reminding whoever it belongs to until the chore is ticked off, instead of once. Reminders for these break through Focus modes and make a sound.';
