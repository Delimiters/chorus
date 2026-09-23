/**
 * Writing or editing one note.
 *
 * Title optional, body free. Nothing here is a task: no due date, no assignee,
 * no checkbox. The moment a note grows one it is a chore with worse
 * ergonomics, and two ways to track the same work is how the two disagree.
 *
 * ── It says who touched it last, and that is the whole concurrency story ──
 *
 * Two people typing into one note is real in a two-person house. Operational
 * transform is absurd at this size; the honest version is last-write-wins with
 * a footer that says whose write won. If a save lands on top of somebody
 * else's, the footer is how you find out — the same contract as a shared
 * document opened twice offline, and a great deal less than the feature
 * appears to promise.
 */

import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackBar, Button, Field, Stack, Txt } from '@/design/components';
import { useTheme } from '@/design/theme';
import { space } from '@/design/tokens';
import { formatSince } from '@/features/common/format';

export interface NoteEditorProps {
  readonly initialTitle: string | null;
  readonly initialBody: string;
  /** Absent when the note is new. */
  readonly editedBy?: string | null;
  readonly editedAt?: string | null;
  readonly saving: boolean;
  readonly error: string | null;
  readonly onSave: (input: { title: string | null; body: string }) => void;
  readonly onDelete?: (() => void) | undefined;
  readonly onBack: () => void;
}

export function NoteEditor({
  initialTitle,
  initialBody,
  editedBy = null,
  editedAt = null,
  saving,
  error,
  onSave,
  onDelete,
  onBack,
}: NoteEditorProps) {
  const { colors } = useTheme();
  const [title, setTitle] = useState(initialTitle ?? '');
  const [body, setBody] = useState(initialBody);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const since = editedAt === null ? null : formatSince(editedAt);
  // Nothing to save is not an error, it is just nothing — the button says so
  // rather than failing after the tap.
  const empty = title.trim().length === 0 && body.trim().length === 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <BackBar onPress={onBack} label="Notes" />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        keyboardShouldPersistTaps="handled"
      >
        <Field
          label="Title"
          value={title}
          onChangeText={setTitle}
          placeholder="Optional"
          maxLength={120}
        />

        <Field
          label="Note"
          value={body}
          onChangeText={setBody}
          placeholder="Anything worth coming back to"
          multiline
          maxLength={20000}
        />

        {error === null ? null : (
          <Txt variant="small" tone="danger">
            {error}
          </Txt>
        )}

        <Button
          label={saving ? 'Saving…' : 'Save'}
          onPress={() => onSave({ title: title.trim().length === 0 ? null : title.trim(), body })}
          loading={saving}
          disabled={empty}
        />

        {/*
          The footer, and the only protection against a silent overwrite.
          Below the save button rather than above it, because it is history
          rather than something to act on.
        */}
        {editedBy === null || since === null ? null : (
          <Txt variant="small" tone="faint">
            {`${editedBy} edited this ${since}.`}
          </Txt>
        )}

        {onDelete === undefined ? null : (
          <View style={{ paddingTop: space.xl }}>
            {confirmingDelete ? (
              <Stack gap={space.sm}>
                <Txt variant="small" tone="muted">
                  This deletes it for both of you.
                </Txt>
                <Button label="Delete it" variant="secondary" onPress={onDelete} />
                <Button
                  label="Keep it"
                  variant="ghost"
                  onPress={() => setConfirmingDelete(false)}
                />
              </Stack>
            ) : (
              /*
               * Confirmed, unlike most destructive actions in this app, which
               * are undoable. A note has no undo and no completion history to
               * reconstruct it from — once it is gone the text is gone.
               */
              <Button label="Delete" variant="ghost" onPress={() => setConfirmingDelete(true)} />
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
