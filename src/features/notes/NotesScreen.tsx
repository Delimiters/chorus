/**
 * The shared note board.
 *
 * Jake: *"Somewhere to kind of write stuff down that's not quite ready to be a
 * task or isn't a task at all but we can check in on."* Several notes rather
 * than one big board, which is what he chose when asked.
 *
 * Newest edit first, because a board sorted by creation puts the thing you
 * were just working on at the bottom.
 *
 * A tab since 2026-09-30, where the Chores library used to be. Jake: *"the
 * note board needs to be more visible."* Buried two taps deep on the House
 * tab, it was competing with a list of household settings; the library it
 * replaced is consulted while setting things up rather than daily, so it moved
 * the other way. No back bar, because a tab has nowhere to go back to.
 */

import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useMembers } from '@/data/hooks/useHousehold';
import { useNotes } from '@/data/hooks/useNotes';
import { AddChoreButton, ADD_BUTTON_CLEARANCE } from '@/design/AddButton';
import { ErrorState, LoadingState, Stack, Txt } from '@/design/components';
import { inkColor } from '@/design/inks';
import { useTheme } from '@/design/theme';
import { space } from '@/design/tokens';
import { useUserId } from '@/stores/sessionStore';

import { NoteCard } from '@/features/common/NoteCard';
import { useMarkNotesSeen } from './useUnseenNotes';

export function NotesScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const notes = useNotes();
  const members = useMembers();
  const userId = useUserId();

  /*
   * Clears the tab badge while this screen is focused. Called unconditionally,
   * above the loading and error returns, because a hook cannot live below one —
   * and marking an empty board seen is harmless.
   */
  useMarkNotesSeen();

  const nameOf = (id: string | null) => {
    if (id === null) return null;
    if (id === userId) return 'You';
    return (members.data ?? []).find((m) => m.userId === id)?.displayName ?? null;
  };
  const inkOf = (id: string | null) => {
    const member = (members.data ?? []).find((m) => m.userId === id);
    return member === undefined ? null : inkColor(member.accent, isDark);
  };

  const myInk = inkOf(userId);

  if (notes.isLoading) return <LoadingState label="Loading your notes" />;
  if (notes.error) {
    return <ErrorState message={(notes.error as Error).message} onRetry={notes.refetch} />;
  }

  const list = notes.data ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      {/* A route fallback, not a bare `back()`: a cold start straight to
          /notes has no history, and `back()` there does nothing at all. */}
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: ADD_BUTTON_CLEARANCE }}
      >
        <Stack gap={2} style={{ paddingHorizontal: space.sm, paddingBottom: space.md }}>
          <Txt variant="display" accessibilityRole="header">
            Notes
          </Txt>
          <Txt variant="mono" tone="faint">
            {list.length === 1 ? '1 NOTE' : `${list.length} NOTES`}
          </Txt>
        </Stack>

        {list.length === 0 ? (
          /*
           * An invitation, not an error. An empty board is the ordinary state
           * of a household that has not needed one yet.
           */
          <View style={{ alignItems: 'center', paddingVertical: space.xxl, gap: space.sm }}>
            <Txt variant="bodyStrong" accessibilityRole="header">
              Nothing written down yet.
            </Txt>
            <Txt variant="small" tone="muted" style={{ textAlign: 'center' }}>
              For the things that are not quite chores — the boiler, the wifi password, what to ask
              the landlord.
            </Txt>
          </View>
        ) : (
          <Stack gap={space.xs}>
            {list.map((note) => (
              <NoteCard
                key={note.id}
                title={note.title}
                body={note.body}
                editorName={nameOf(note.updatedBy)}
                editorInk={inkOf(note.updatedBy)}
                updatedAt={note.updatedAt}
                onPress={() => router.push(`/note/${note.id}`)}
              />
            ))}
          </Stack>
        )}
      </ScrollView>

      <AddChoreButton onPress={() => router.push('/note/new')} ink={myInk} label="Write a note" />
    </SafeAreaView>
  );
}
