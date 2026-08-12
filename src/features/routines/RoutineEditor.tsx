/**
 * The screen behind the routine form.
 *
 * Kept out of `src/app/` for the same reason `ChoreEditor` is: a `.test.tsx`
 * under the router's directory is treated as a route, which once put `expect`
 * into the app bundle. Routes are thin wrappers; screens live here.
 */

import { useRouter } from 'expo-router';

import type { CalendarConfig } from '@/core/civil/types';
import type { RoutineDraft } from '@/data/api/routines';
import { useHousehold } from '@/data/hooks/useHousehold';
import { useChoreList } from '@/data/hooks/useChores';
import {
  useCreateRoutineItem,
  useDeleteRoutineItem,
  useRoutineItem,
  useUpdateRoutineItem,
} from '@/data/hooks/useRoutines';
import { useToday } from '@/data/today';
import { useUserId } from '@/stores/sessionStore';
import { ErrorState, LoadingState } from '@/design/components';
import { RoutineForm } from './RoutineForm';

export function RoutineEditor({
  itemId,
  initialLinkedChoreId = null,
  initialTitle,
}: {
  itemId: string | null;
  /** Set when arriving from a chore's sheet. */
  initialLinkedChoreId?: string | null;
  initialTitle?: string | undefined;
}) {
  const router = useRouter();
  const household = useHousehold();
  const today = useToday(household.data?.timeZone ?? 'UTC');

  const calendar: CalendarConfig = {
    weekStartsOn: (household.data?.weekStartsOn ?? 0) as CalendarConfig['weekStartsOn'],
  };

  const { item, isPending } = useRoutineItem(itemId);
  const userId = useUserId();
  const chores = useChoreList();
  const create = useCreateRoutineItem();
  const update = useUpdateRoutineItem();
  const remove = useDeleteRoutineItem();

  // Editing something that has not arrived yet: wait rather than opening the
  // form empty, which would look like a new item and save as a duplicate.
  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  if (itemId !== null && isPending) return <LoadingState />;

  // Loaded, and still nothing: archived, deleted, or never yours. Said plainly
  // rather than spinning forever.
  if (itemId !== null && item === undefined) {
    return <ErrorState message="That routine item is not here any more." onRetry={close} />;
  }

  /*
   * A housemate's shared item is readable, and that is all.
   *
   * `useRoutineItem` searches everything you can see, which includes their
   * routine once they have shared it. Without this, opening one gave a fully
   * editable form whose save RLS filtered to nothing — no error, no change,
   * and the screen closing exactly as though it had worked.
   */
  if (item !== undefined && item.ownerId !== userId) {
    return (
      <ErrorState
        message="This is somebody else’s routine. You can look, but not change it."
        onRetry={close}
      />
    );
  }

  const submit = (draft: RoutineDraft) => {
    if (item) update.mutate({ itemId: item.id, draft }, { onSuccess: close });
    else create.mutate(draft, { onSuccess: close });
  };

  const pending = create.isPending || update.isPending;
  const failure = (create.error ?? update.error ?? remove.error) as Error | null;

  return (
    <RoutineForm
      item={item}
      chores={chores.data?.chores ?? []}
      initialLinkedChoreId={initialLinkedChoreId}
      {...(initialTitle === undefined ? {} : { initialTitle })}
      today={today}
      calendar={calendar}
      onSubmit={submit}
      onCancel={close}
      {...(item
        ? { onDelete: () => remove.mutate({ itemId: item.id }, { onSuccess: close }) }
        : {})}
      isSaving={pending}
      error={failure?.message ?? null}
    />
  );
}
