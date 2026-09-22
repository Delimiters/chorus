-- ═══════════════════════════════════════════════════════════════════════════
-- The plan starts empty
--
-- Recurring work that was due or late went onto your plan by itself every
-- morning. That was asked for — "the litter box is not a decision" — and it
-- made the plan fill up with things nobody had chosen. Emily's complaint,
-- twice now, is that there is too much on it.
--
-- Jake: *"I guess we should go back to having the plan page just start empty
-- and you have to add everything manually ... Basically I want it to be where
-- whatever Emily wants me to do today she can assign me and there will be no
-- confusion as to whether something is getting done today or not. **If I added
-- it to the plan I'm doing it.**"*
--
-- That last sentence is the feature. A plan row is a promise, and a promise
-- nobody made is not one. Auto-filling put rows on the plan that carried no
-- intention, so the plan stopped being evidence of anything — which is exactly
-- the confusion he describes.
--
-- ── Why the household and not the person ──────────────────────────────────
--
-- This is a preference, and preferences in this app are usually per person
-- (`plan_group_order`, every "on this phone" toggle). This one is not, because
-- it does not change how the plan *looks* — it changes what a row on it
-- *means*. If Jake's plan filled itself and Emily's did not, the same row would
-- mean "I am doing this" on one phone and "the app put this here" on the other,
-- and the shared contract above would be worth nothing. One switch for the
-- house is the only setting that keeps the promise legible to both of them.
--
-- ── Default false, including for the household that already exists ────────
--
-- `not null default false` with no backfill statement is deliberate: adding
-- the column writes `false` into every existing row, which turns the behaviour
-- off for Jake and Emily immediately. That is the change being asked for, not
-- a migration hazard. *"For now have that setting be off so our days start
-- completely clear."*
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.households
  add column auto_plan boolean not null default false;

comment on column public.households.auto_plan is
  'Whether recurring work that is due or late is added to each plan automatically. Off by default: a plan row is meant to be a promise somebody made, and the household shares one answer so a row means the same thing on both phones.';
