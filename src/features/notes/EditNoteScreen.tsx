/** Reading and editing a note somebody already wrote. */
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useMembers } from '@/data/hooks/useHousehold';
import { useDeleteNote, useNotes, useUpdateNote } from '@/data/hooks/useNotes';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackBar, Button, ErrorState, LoadingState, Txt } from '@/design/components';
import { useTheme } from '@/design/theme';
import { space } from '@/design/tokens';
import { useUserId } from '@/stores/sessionStore';

import { NoteEditor } from './NoteEditor';

export function EditNoteScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const notes = useNotes();
  const members = useMembers();
  const userId = useUserId();
  const { colors } = useTheme();
  const update = useUpdateNote();
  const remove = useDeleteNote();

  /*
   * A dead end otherwise. Every pushed screen in this app falls back to a
   * route rather than a bare `back()`, because a cold start — a deep link, or
   * a notification tap once those exist — has no history to go back to.
   */
  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/notes');
  };

  if (notes.isLoading) return <LoadingState label="Loading the note" />;

  /*
   * A failed fetch is not a deleted note. Without this branch the error case
   * falls through to "That note is gone" below, which is a confident and
   * wrong answer to a dropped connection.
   */
  if (notes.error) {
    return <ErrorState message={(notes.error as Error).message} onRetry={notes.refetch} />;
  }

  const note = (notes.data ?? []).find((n) => n.id === id);
  if (note === undefined) {
    /*
     * Deleted by the other phone while you were looking at it, most likely —
     * ordinary on a shared board. `ErrorState` heads this "Something went
     * wrong" and labels its button "Try again", neither of which is true
     * here, so this says it plainly instead.
     */
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
        <BackBar onPress={leave} label="Notes" />
        <View style={{ padding: space.xl, gap: space.sm, alignItems: 'center' }}>
          <Txt variant="bodyStrong" accessibilityRole="header">
            That note is gone.
          </Txt>
          <Txt variant="small" tone="muted" style={{ textAlign: 'center' }}>
            Somebody deleted it. Nothing you did.
          </Txt>
          <View style={{ paddingTop: space.md }}>
            <Button label="Back to the notes" onPress={leave} />
          </View>
        </View>
      </SafeAreaView>
    );
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
      onBack={leave}
      onSave={(input) =>
        update.mutate({ id: note.id, ...input }, { onSuccess: () => router.back() })
      }
      onDelete={() => remove.mutate(note.id, { onSuccess: () => router.back() })}
    />
  );
}
