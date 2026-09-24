/** Writing a note for the first time. */
import { useRouter } from 'expo-router';

import { useCreateNote } from '@/data/hooks/useNotes';

import { NoteEditor } from './NoteEditor';

export function NewNoteScreen() {
  const router = useRouter();
  const create = useCreateNote();

  return (
    <NoteEditor
      initialTitle={null}
      initialBody=""
      saving={create.isPending}
      error={(create.error as Error | null)?.message ?? null}
      onBack={() => {
        if (router.canGoBack()) router.back();
        else router.replace('/notes');
      }}
      onSave={(input) => {
        create.mutate(input, {
          // Back to the board, not into the note just written: you came here
          // to write it down, and the thing you wanted is now on the list.
          onSuccess: () => {
            if (router.canGoBack()) router.back();
            else router.replace('/notes');
          },
        });
      }}
    />
  );
}
