-- ═══════════════════════════════════════════════════════════════════════════
-- Icons for chores and categories
--
-- Plain nullable text, with a length bound and nothing else.
--
-- Deliberately no CHECK listing the permitted names. The set of icons is a
-- design decision that will change — adding one to the picker should be a
-- one-line change in src/design/icons.ts, not a migration — and a constraint
-- enumerating them would couple the schema to a component. Validation lives in
-- `toIconName`, which degrades an unrecognised name to no icon rather than
-- letting one bad row blank a list.
--
-- The length bound is the part worth keeping in the database: it stops a bug
-- or a hostile client writing something unbounded into a column that is read
-- on every render.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.chores
  add column icon text check (icon is null or char_length(icon) between 1 and 60);

alter table public.chore_categories
  add column icon text check (icon is null or char_length(icon) between 1 and 60);

comment on column public.chores.icon is
  'MaterialCommunityIcons glyph name, validated against the allowlist in src/design/icons.ts.';
comment on column public.chore_categories.icon is
  'MaterialCommunityIcons glyph name, validated against the allowlist in src/design/icons.ts.';

-- No new grants or policies: both columns live on tables that already have
-- them, and column-level privileges are not used anywhere in this schema.
