/**
 * The screen behind the chore form.
 *
 * Kept out of `src/app/` deliberately: a `.test.tsx` under the router's
 * directory is treated as a route, which once put `expect` into the app bundle
 * and broke the web build entirely. Routes are thin wrappers; the screens live
 * here. A lint rule enforces it.
 */

import { useRouter } from 'expo-router';

import type { CalendarConfig } from '@/core/civil/types';
import type { ChoreDraft } from '@/data/api/chores';
import { useArchiveChore, useChore, useCreateChore, useUpdateChore } from '@/data/hooks/useChores';
import { useReplaceSubtasks, useSubtasksFor } from '@/data/hooks/useSubtasks';
import { useHousehold, useMembers } from '@/data/hooks/useHousehold';
import { useToday } from '@/data/today';
import { LoadingState } from '@/design/components';
import { useUserId } from '@/stores/sessionStore';
import { ChoreForm } from './ChoreForm';

export function ChoreEditor({ choreId }: { choreId: string | null }) {
  const router = useRouter();
  const userId = useUserId();
  const household = useHousehold();
  const members = useMembers();
  const today = useToday(household.data?.timeZone ?? 'UTC');

  const calendar: CalendarConfig = {
    weekStartsOn: (household.data?.weekStartsOn ?? 0) as CalendarConfig['weekStartsOn'],
  };

  const chore = useChore(choreId);
  const create = useCreateChore();
  const update = useUpdateChore();
  const archive = useArchiveChore();
  const steps = useSubtasksFor(choreId);
  const saveSteps = useReplaceSubtasks();

  // Editing a chore that has not arrived yet: wait rather than opening the form
  // empty, which would look like a new chore and save as a duplicate.
  if (choreId !== null && chore === undefined) return <LoadingState />;

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/chores');
  };

  /*
   * The chore row and its steps are two writes, in that order.
   *
   * A new chore has no id until it is saved, so the steps cannot be written
   * first — and a chore that saved while its steps failed is a better failure
   * than steps orphaned by a chore that never existed.
   */
  const submit = (draft: ChoreDraft) => {
    const steps = draft.subtasks ?? [];
    const afterSave = (savedChoreId: string) => {
      saveSteps.mutate({ choreId: savedChoreId, steps }, { onSuccess: close, onError: close });
    };

    if (chore)
      update.mutate({ choreId: chore.id, draft }, { onSuccess: () => afterSave(chore.id) });
    else create.mutate(draft, { onSuccess: (newChoreId) => afterSave(newChoreId) });
  };

  const pending = create.isPending || update.isPending;
  const failure = (create.error ?? update.error ?? archive.error) as Error | null;

  return (
    <ChoreForm
      chore={chore}
      members={(members.data ?? []).map((m) => ({
        userId: m.userId,
        displayName: m.displayName,
        accent: m.accent,
      }))}
      userId={userId}
      subtasks={steps.map((s) => ({ id: s.id, title: s.title }))}
      today={today}
      calendar={calendar}
      onSubmit={submit}
      onCancel={close}
      isSaving={pending}
      error={failure?.message ?? null}
      {...(chore
        ? {
            onArchive: () =>
              archive.mutate(
                { choreId: chore.id, archived: !chore.archived },
                { onSuccess: close },
              ),
          }
        : {})}
    />
  );
}
