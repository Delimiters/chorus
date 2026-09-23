-- ═══════════════════════════════════════════════════════════════════════════
-- Auto-fill back on, now that there is no backlog to drown in
--
-- `auto_plan` shipped a day ago defaulting to `false`, because the plan was
-- filling with weeks of overdue work and Emily's complaint — twice — was that
-- there was too much on it.
--
-- Jake: *"I still want you to add that don't autopopulate setting but I think
-- we actually want to leave autopopulate on for now. Emily reviewed everything
-- and got everything back onto a good schedule so we don't just have a million
-- things overdue."*
--
-- So the setting stays and the value flips. That is the right shape: the
-- switch was never really about whether filling is a good idea, it was about
-- whether the thing being filled in was worth looking at. With the schedules
-- corrected, it is.
--
-- ── Both the default and the existing row ─────────────────────────────────
--
-- Changing the column default alone would do nothing for the household that
-- exists — defaults apply to inserts. The update is the part that changes
-- anything today; the default is so a household created next month starts the
-- same way rather than inheriting a decision made during one bad week.
--
-- Safe to run twice, and deliberately not conditional on the current value:
-- "on" is the state being asserted, not a toggle.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.households
  alter column auto_plan set default true;

update public.households
   set auto_plan = true;

comment on column public.households.auto_plan is
  'Whether the backlog — anything still late from earlier days, one-off tasks included — is added to each plan each morning. On by default since 2026-09-23. With it off the plan still fills with what is due today and anything either of you has flagged.';
