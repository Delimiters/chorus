/**
 * The plan, wired to real data.
 *
 * `PlanScreen` renders a day; this decides which occurrences exist, which of
 * them are already committed to, and what the picker should offer. Kept apart
 * so the screen stays testable without a `QueryClient`, the same split
 * `RoutinesView` uses.
 */

import { useMemo, useState } from 'react';

import { splitByUrgency, type AgendaItem } from '@/core/occurrence/agenda';
import { unfinishedBefore } from '@/core/plan/plan';
import { useCategoryList } from '@/data/hooks/useCategories';
import { useToday_View } from '@/data/hooks/useOccurrences';
import { useAddToPlan, useMyPlanEntries } from '@/data/hooks/usePlan';
import { ErrorState, LoadingState } from '@/design/components';
import { PlanPicker, type PickerGroup } from './PlanPicker';
import { PlanScreen } from './PlanScreen';

export function PlanView() {
  const { view, chores, today, isLoading, error, refetch } = useToday_View();
  const categories = useCategoryList();
  const entries = useMyPlanEntries(today);
  const add = useAddToPlan(today);
  const [picking, setPicking] = useState(false);

  /**
   * Everything the plan could name, including what is already done today.
   *
   * `view.floating` matters here and was missing: `buildTodayView` splits
   * floating groups out of `mine`/`theirs`, so every "3× a week" chore was
   * invisible to the plan — not offered by the picker, not renderable if
   * somehow planned. A floating group's `nextSlot` is the occurrence you would
   * actually do next, so that is the one the plan can hold.
   */
  const floatingSlots = useMemo(
    () =>
      view.floating
        .map((group) => group.nextSlot)
        .filter((slot): slot is AgendaItem => slot !== null),
    [view.floating],
  );

  const available = useMemo(
    () => [...view.mine, ...view.theirs, ...view.done, ...view.skipped, ...floatingSlots],
    [view.mine, view.theirs, view.done, view.skipped, floatingSlots],
  );

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const choreCategory = useMemo(() => new Map(chores.map((c) => [c.id, c.categoryId])), [chores]);

  /**
   * What the picker offers, grouped by *why you might pick it*.
   *
   * Deliberately not grouped by category: "Kitchen" answers "what kind of
   * thing is this", which is a question for the library. Here the question is
   * "what should be on today", and left-over, late and due are the answers to
   * that one.
   *
   * Anything already planned is excluded rather than shown ticked — the picker
   * is for adding, and a list where half the rows do nothing is a list you
   * have to read twice.
   */
  const groups = useMemo((): readonly PickerGroup[] => {
    const planned = new Set(
      entries.filter((e) => e.plannedFor === today).map((e) => e.occurrenceKey),
    );
    const outstanding = [...view.mine, ...view.theirs, ...floatingSlots].filter(
      (item) => !planned.has(item.occurrenceKey),
    );

    const leftOver = unfinishedBefore(entries, today, outstanding);
    const leftKeys = new Set(leftOver.map((i) => i.occurrenceKey));
    const rest = outstanding.filter((item) => !leftKeys.has(item.occurrenceKey));
    const urgency = splitByUrgency(rest, today);

    const candidates: readonly PickerGroup[] = [
      // First, because you already decided these mattered once and did not get
      // to them. That is a stronger signal than anything the app can compute.
      { key: 'left', title: 'Left from before', items: leftOver as readonly AgendaItem[] },
      { key: 'late', title: 'Late', items: urgency.late },
      { key: 'today', title: 'Due today', items: urgency.dueToday },
      { key: 'soon', title: 'Coming up', items: urgency.comingUp },
    ];
    return candidates.filter((group) => group.items.length > 0);
  }, [entries, today, view.mine, view.theirs, floatingSlots]);

  if (isLoading) return <LoadingState label="Loading your day" />;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  return (
    <>
      <PlanScreen
        available={available}
        chores={chores}
        today={today}
        refetch={refetch}
        onAdd={() => setPicking(true)}
      />
      <PlanPicker
        open={picking}
        groups={groups}
        categoryFor={(choreId) => {
          const category = categoryById.get(choreCategory.get(choreId) ?? '');
          return category === undefined ? null : { name: category.name, ink: category.ink };
        }}
        onClose={() => setPicking(false)}
        onAdd={(items) =>
          add.mutate(items.map((i) => ({ occurrenceKey: i.occurrenceKey, choreId: i.choreId })))
        }
      />
    </>
  );
}
