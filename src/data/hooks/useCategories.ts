/**
 * Category reads and writes.
 *
 * Every mutation invalidates the whole household key rather than patching the
 * cache, for the same reason `useChores` does: renaming or deleting a category
 * changes how every screen groups, and there is no surgical patch for "the
 * shape of the agenda is different now".
 *
 * Reordering is the one exception, and it is optimistic — dragging a row and
 * watching it snap back for a round trip is the kind of latency people read as
 * a bug rather than as slowness.
 */

import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useActiveHouseholdId } from '@/stores/sessionStore';
import {
  createCategory,
  deleteCategory,
  listCategories,
  reorderCategories,
  updateCategory,
  type Category,
} from '../api/categories';
import { qk } from '../queryKeys';

export function useCategories() {
  const householdId = useActiveHouseholdId();

  return useQuery({
    queryKey: qk.categories(householdId ?? '__none__'),
    queryFn: householdId === null ? skipToken : () => listCategories(householdId),
  });
}

/** The categories, or an empty list while loading. Convenient for grouping. */
export function useCategoryList(): readonly Category[] {
  return useCategories().data ?? EMPTY;
}

/** Stable identity, so a `useMemo` keyed on it does not re-run every render. */
const EMPTY: readonly Category[] = [];

function useInvalidateHousehold() {
  const householdId = useActiveHouseholdId();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    if (householdId === null) return;
    await queryClient.invalidateQueries({ queryKey: qk.household(householdId) });
  }, [householdId, queryClient]);
}

export function useCreateCategory() {
  const householdId = useActiveHouseholdId();
  const invalidate = useInvalidateHousehold();

  return useMutation({
    mutationFn: (input: { name: string; ink: string | null; icon: string | null }) => {
      if (householdId === null) throw new Error('Please sign in again.');
      return createCategory(householdId, input);
    },
    onSuccess: invalidate,
  });
}

export function useUpdateCategory() {
  const invalidate = useInvalidateHousehold();

  return useMutation({
    mutationFn: ({
      categoryId,
      ...input
    }: {
      categoryId: string;
      name: string;
      ink: string | null;
      icon: string | null;
    }) => updateCategory(categoryId, input),
    onSuccess: invalidate,
  });
}

export function useDeleteCategory() {
  const invalidate = useInvalidateHousehold();

  return useMutation({
    mutationFn: ({ categoryId }: { categoryId: string }) => deleteCategory(categoryId),
    onSuccess: invalidate,
  });
}

/**
 * Reordering, applied to the cache immediately and reconciled on settle.
 *
 * The optimistic list is written straight to the categories key rather than
 * the household prefix. Patching the prefix would be wrong for the reason
 * documented on `qk.completionsAll`: several unrelated arrays live under it,
 * and a blind write reaches all of them.
 */
export function useReorderCategories() {
  const householdId = useActiveHouseholdId();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateHousehold();

  return useMutation({
    mutationFn: ({ orderedIds }: { orderedIds: readonly string[] }) =>
      reorderCategories(orderedIds),

    onMutate: async ({ orderedIds }) => {
      if (householdId === null) return { previous: undefined };
      const key = qk.categories(householdId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<readonly Category[]>(key);

      if (previous !== undefined) {
        const byId = new Map(previous.map((c) => [c.id, c]));
        const reordered = orderedIds
          .map((id, index) => {
            const category = byId.get(id);
            return category === undefined ? undefined : { ...category, position: index };
          })
          .filter((c): c is Category => c !== undefined);
        queryClient.setQueryData(key, reordered);
      }
      return { previous };
    },

    onError: (_error, _variables, context) => {
      if (householdId === null || context?.previous === undefined) return;
      queryClient.setQueryData(qk.categories(householdId), context.previous);
    },

    onSettled: invalidate,
  });
}
