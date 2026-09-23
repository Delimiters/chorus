/** Reading and editing a note somebody already wrote. */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useMembers } from '@/data/hooks/useHousehold';
import { useDeleteNote, useNotes, useUpdateNote } from '@/data/hooks/useNotes';
import { ErrorState, LoadingState } from '@/design/components';
import { useUserId } from '@/stores/sessionStore';

import { NoteEditor } from './NoteEditor';

export function EditNoteScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const notes = useNotes();
  const members = useMembers();
  const userId = useUserId();
  const update = useUpdateNote();
  const remove = useDeleteNote();

  if (notes.isLoading) return <LoadingState label="Loading the note" />;

  const note = (notes.data ?? []).find((n) => n.id === id);
  if (note === undefined) {
    /*
     * Deleted by the other phone while you were looking at it, most likely —
     * which is ordinary on a shared board and not worth an apology.
     */
    return <ErrorState message="That note is gone." onRetry={() => router.back()} />;
  }

  const editorName =
    note.updatedBy === null
      ? null
      : note.updatedBy === userId
        ? 'You'
        : ((members.data ?? []).find((m) => m.userId === note.updatedBy)?.displayName ?? null);

  return (
    <NoteEditor
      initialTitle={note.title}
      initialBody={note.body}
      editedBy={editorName}
      editedAt={note.updatedAt}
      saving={update.isPending}
      error={((update.error ?? remove.error) as Error | null)?.message ?? null}
      onBack={() => router.back()}
      onSave={(input) =>
        update.mutate({ id: note.id, ...input }, { onSuccess: () => router.back() })
      }
      onDelete={() => remove.mutate(note.id, { onSuccess: () => router.back() })}
    />
  );
}
