/**
 * Chore categories.
 *
 * Household-scoped, user-named, and ordered by an integer `position`.
 *
 * Note what is *not* here: an "Other" category. Other is the absence of a
 * category — `chores.category_id is null` — rather than a row, so there is
 * nothing to create, rename or delete. See the categories migration for why.
 */

import type { CategoryMeta } from '@/core/occurrence/grouping';
import { describeError, supabase } from '../supabase';

function fail(error: { code?: string | undefined; message: string }): never {
  throw new Error(describeError(error));
}

/** A category row. Structurally a `CategoryMeta`, so grouping accepts it as-is. */
export interface Category extends CategoryMeta {
  readonly id: string;
  readonly name: string;
  readonly ink: string | null;
  /**
   * The icon a chore gets when it is filed here, unless it has its own.
   *
   * A default rather than a rule: most kitchen chores want the same glyph, and
   * picking one per chore is a tax on the common case.
   */
  readonly icon: string | null;
  readonly position: number;
}

export async function listCategories(householdId: string): Promise<readonly Category[]> {
  const { data, error } = await supabase
    .from('chore_categories')
    .select('id, name, ink, icon, position')
    .eq('household_id', householdId)
    // Name as the tiebreak, matching the comparator in core/occurrence/grouping
    // so the order is identical whether it came from here or was re-sorted
    // client-side after an edit.
    .order('position')
    .order('name');
  if (error) fail(error);
  return data ?? [];
}

/** Trims and rejects an unusable name before the database has to. */
function cleanName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error('A category needs a name.');
  if (trimmed.length > 40) throw new Error('That name is too long — 40 characters at most.');
  return trimmed;
}

/**
 * Creates a category at the end of the list.
 *
 * The position is computed from the current rows rather than in the database,
 * because there is no sequence per household and a fixed default of 0 would
 * put every new category first. Two people adding a category at the same
 * instant can collide on a position; the comparator breaks that tie by name,
 * so the result is stable rather than arbitrary, and either can reorder after.
 */
export async function createCategory(
  householdId: string,
  input: { name: string; ink: string | null; icon: string | null },
): Promise<string> {
  const existing = await listCategories(householdId);
  const position = existing.reduce((max, c) => Math.max(max, c.position), -1) + 1;

  const { data, error } = await supabase
    .from('chore_categories')
    .insert({
      household_id: householdId,
      name: cleanName(input.name),
      ink: input.ink,
      icon: input.icon,
      position,
    })
    .select('id')
    .single();
  if (error) {
    // The unique constraint is on (household_id, name), and "that name is
    // taken" is far more useful than the raw constraint text.
    if (error.code === '23505') throw new Error('There is already a category with that name.');
    fail(error);
  }
  return data.id;
}

export async function updateCategory(
  categoryId: string,
  input: { name: string; ink: string | null; icon: string | null },
): Promise<void> {
  const { error } = await supabase
    .from('chore_categories')
    .update({ name: cleanName(input.name), ink: input.ink, icon: input.icon })
    .eq('id', categoryId);
  if (error) {
    if (error.code === '23505') throw new Error('There is already a category with that name.');
    fail(error);
  }
}

/**
 * Deletes a category. Its chores survive, and fall back into Other.
 *
 * That is the database's `on delete set null` doing the work, not this
 * function — which is the point. A category is a label, and removing a label
 * must never remove the thing it was on, nor the completion history hanging
 * off it.
 */
export async function deleteCategory(categoryId: string): Promise<void> {
  const { error } = await supabase.from('chore_categories').delete().eq('id', categoryId);
  if (error) fail(error);
}

/**
 * Rewrites every position to match the given order.
 *
 * Dense integers, rewritten wholesale. A household has a handful of
 * categories, so the fractional indexing that makes reordering cheap at scale
 * would be pure overhead — and this way positions never drift into the
 * float-precision territory where two of them become indistinguishable.
 *
 * Not a transaction, and it does not need to be: a partial failure leaves some
 * categories renumbered and the rest where they were, which is a different
 * order rather than a broken one, and the next reorder fixes it. Wrapping this
 * in an RPC to gain atomicity would buy nothing a user could perceive.
 */
export async function reorderCategories(orderedIds: readonly string[]): Promise<void> {
  const updates = orderedIds.map((id, index) =>
    supabase.from('chore_categories').update({ position: index }).eq('id', id),
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error !== null);
  if (failed?.error) fail(failed.error);
}
