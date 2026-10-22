/**
 * A note, open for reading.
 *
 * Jake: *"I should be able to open it and still just view, so it's easy to
 * click links and whatnot, and then have an edit button to actually change the
 * text."* Opening straight into a text field made the links untappable — a
 * `TextInput` swallows the tap — so the most useful thing in a note was the one
 * thing you could not use.
 *
 * Reading is the default and editing is the deliberate act, which is the right
 * way round for a board two people share: most opens are to check something.
 */

import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackBar, Button, Txt } from '@/design/components';
import { NoteBody } from '@/design/NoteBody';
import { useTheme } from '@/design/theme';
import { space } from '@/design/tokens';

import { formatSince } from '@/features/common/format';

interface Props {
  readonly title: string | null;
  readonly body: string;
  readonly editedBy: string | null;
  readonly editedAt: string | null;
  readonly onEdit: () => void;
  readonly onBack: () => void;
  readonly backLabel?: string;
}

export function NoteReader({
  title,
  body,
  editedBy,
  editedAt,
  onEdit,
  onBack,
  backLabel = 'Notes',
}: Props) {
  const { colors } = useTheme();
  const since = editedAt === null ? null : formatSince(editedAt);
  const empty = body.trim().length === 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <BackBar onPress={onBack} label={backLabel} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
        {title === null || title.trim().length === 0 ? null : (
          <Txt variant="display" accessibilityRole="header">
            {title}
          </Txt>
        )}

        {empty ? (
          <Txt variant="body" tone="muted">
            This note is empty.
          </Txt>
        ) : (
          <NoteBody note={body} />
        )}

        {/*
          Below the note, not in the bar. The bar holds the way back, and a
          note long enough to scroll should not have its only action pinned
          where you cannot see what you are about to change.
        */}
        <View style={{ paddingTop: space.sm }}>
          <Button label="Edit" onPress={onEdit} variant="secondary" />
        </View>

        {editedBy === null || since === null ? null : (
          <Txt variant="small" tone="faint">
            {`Last edited by ${editedBy} ${since}`}
          </Txt>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
