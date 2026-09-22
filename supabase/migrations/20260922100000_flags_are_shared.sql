-- ═══════════════════════════════════════════════════════════════════════════
-- A flag belongs to the household, not to the person who raised it
--
-- Flagging already showed the "!!" on both phones and lifted the chore to the
-- top of both plans — every *read* was household-wide. Only the write was
-- personal: `chore_flags_delete` was `user_id = auth.uid()`, so Emily could see
-- Jake's flag and not lift it, and her sheet offered "Flag it" on something
-- already flagged, quietly adding a second row.
--
-- Jake: *"If I flag something does it flag it for both of us? Because I want it
-- to."* It did, for everything except undoing it.
--
-- This is the same trust model the rest of the app already uses — either
-- housemate may edit the other's plan, un-complete the other's chore, and
-- change household settings. Flags were the one thing access-controlled
-- between two people who are not access-controlling each other.
--
-- ── What stays per person ─────────────────────────────────────────────────
--
-- The row keeps `user_id`, and inserting still requires it to be you. Who
-- raised a flag is worth recording even though nothing displays it today, and
-- "either of you may raise your own" plus "either of you may clear any" is
-- enough to make the flag behave as one shared mark. Collapsing to a single
-- row per chore would throw that away and need a dedup migration for no gain.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy chore_flags_delete on public.chore_flags;

create policy chore_flags_delete on public.chore_flags
  for delete to authenticated
  using (
    private.is_household_member(household_id)
    and private.chore_is_visible(chore_id)
  );

comment on table public.chore_flags is
  'A chore marked for attention. Raised by one person, shared by the household: either member may clear it, and completing the chore clears it for everyone.';

comment on column public.chore_flags.user_id is
  'Who raised it. Recorded, not a permission — either housemate may clear any flag in the household.';
