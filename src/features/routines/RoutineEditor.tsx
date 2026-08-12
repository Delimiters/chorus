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
import { LoadingState } from '@/design/components';
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

  const item = useRoutineItem(itemId);
  const chores = useChoreList();
  const create = useCreateRoutineItem();
  const update = useUpdateRoutineItem();
  const remove = useDeleteRoutineItem();

  // Editing something that has not arrived yet: wait rather than opening the
  // form empty, which would look like a new item and save as a duplicate.
  if (itemId !== null && item === undefined) return <LoadingState />;

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

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
