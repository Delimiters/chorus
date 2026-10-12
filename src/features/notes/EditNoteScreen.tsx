/** Reading and editing a note somebody already wrote. */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { useMembers } from '@/data/hooks/useHousehold';
import { useDeleteNote, useNotes, useUpdateNote } from '@/data/hooks/useNotes';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackBar, Button, ErrorState, LoadingState, Txt } from '@/design/components';
import { useTheme } from '@/design/theme';
import { space } from '@/design/tokens';
import { useUserId } from '@/stores/sessionStore';

import { NoteEditor } from './NoteEditor';
import { NoteReader } from './NoteReader';

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
   * Reading by default, which is what opening a note usually means — and the
   * only state in which its links can be tapped, because a `TextInput`
   * swallows the tap. Editing is the deliberate act.
   */
  const [editing, setEditing] = useState(false);

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

  if (!editing) {
    return (
      <NoteReader
        title={note.title}
        body={note.body}
        editedBy={editorName}
        editedAt={note.updatedAt}
        onEdit={() => setEditing(true)}
        onBack={leave}
      />
    );
  }

  return (
    <NoteEditor
      initialTitle={note.title}
      initialBody={note.body}
      editedBy={editorName}
      editedAt={note.updatedAt}
      saving={update.isPending}
      error={((update.error ?? remove.error) as Error | null)?.message ?? null}
      /*
       * Back out of editing, not out of the note. Somebody who opened a note to
       * read it, tapped Edit and changed their mind wants the note, not the
       * list.
       *
       * Labelled "Cancel", which is `BackBar`'s own convention for a form where
       * leaving discards work — and it does: the editor's text lives in its own
       * state, so unmounting it drops anything unsaved. A review pointed out
       * that "Back to note" reads as navigation and gives no hint of that.
       */
      onBack={() => setEditing(false)}
      backLabel="Cancel"
      /*
       * Saving returns to reading rather than popping the screen. The old
       * behaviour threw you back to the board, which meant checking your own
       * edit took another tap — and on a note full of links, reading is where
       * you wanted to be anyway.
       */
      onSave={(input) =>
        update.mutate({ id: note.id, ...input }, { onSuccess: () => setEditing(false) })
      }
      /*
       * `leave()`, not `router.back()`. On a cold start into `/note/<id>` —
       * a deep link, or a notification tap — there is no history, so the pop
       * does nothing and the next render falls into "That note is gone".
       */
      onDelete={() => remove.mutate(note.id, { onSuccess: leave })}
    />
  );
}
