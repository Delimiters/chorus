/**
 * One note, as a card on a list.
 *
 * Deliberately the same shell the House tab already uses for a member row —
 * `colors.sunken`, `radius.md`, `space.md` — so the board belongs to the
 * screen rather than arriving as a new visual language. What differs is the
 * contents, not the frame.
 *
 * ── Two lines of body, hard clipped ───────────────────────────────────────
 *
 * A note is a thing you *check in on*, so the card has to say enough to decide
 * whether to open it and no more. A card that grows to its content turns the
 * board into a wall of text, which is the failure mode this app has hit on
 * every other list it has.
 *
 * Lives in `common` rather than in `features/notes`, because the House tab
 * shows the three most recent notes and a feature importing another feature is
 * a lint error here — and, more to the point, the way `features/chores`
 * quietly became a library.
 *
 * ── No accent rail ────────────────────────────────────────────────────────
 *
 * The author's ink is a dot beside their name, not a 4pt bar down the side.
 * The dot carries the same information in the language the House tab already
 * speaks — avatars and the balance bar — and a stack of rounded cards with
 * coloured left edges is the single most generic thing this could look like.
 */

import { Pressable, View } from 'react-native';

import { Txt } from '@/design/components';
import { radius, space, MIN_TARGET } from '@/design/tokens';
import { useColors } from '@/design/theme';
import { formatSince } from '@/features/common/format';

export interface NoteCardProps {
  readonly title: string | null;
  readonly body: string;
  readonly editorName: string | null;
  readonly editorInk: string | null;
  readonly updatedAt: string;
  readonly onPress: () => void;
}

export function NoteCard({
  title,
  body,
  editorName,
  editorInk,
  updatedAt,
  onPress,
}: NoteCardProps) {
  const colors = useColors();
  const trimmed = body.trim();

  /*
   * People paste a sentence and leave. With no title the first line of the
   * body is promoted, so a card is never top-empty — and the preview drops to
   * one line so the same text is not printed twice.
   */
  const heading = (title ?? '').trim();
  const [firstLine = '', ...rest] = trimmed.split('\n');
  const shownHeading = heading.length > 0 ? heading : firstLine;
  const preview = heading.length > 0 ? trimmed : rest.join('\n').trim();

  const since = formatSince(updatedAt);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={shownHeading.length > 0 ? shownHeading : 'Empty note'}
      onPress={onPress}
      style={{
        minHeight: MIN_TARGET,
        padding: space.md,
        gap: space.xs,
        borderRadius: radius.md,
        backgroundColor: colors.sunken,
      }}
    >
      {shownHeading.length === 0 ? (
        <Txt variant="bodyStrong" tone="faint">
          Empty note
        </Txt>
      ) : (
        <Txt variant="bodyStrong" numberOfLines={1}>
          {shownHeading}
        </Txt>
      )}

      {preview.length === 0 ? null : (
        <Txt variant="small" tone="muted" numberOfLines={heading.length > 0 ? 2 : 1}>
          {preview}
        </Txt>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        {editorInk === null ? null : (
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: radius.pill,
              backgroundColor: editorInk,
            }}
          />
        )}
        <Txt variant="small" tone="faint">
          {[editorName, since].filter((part) => part !== null && part.length > 0).join(' · ')}
        </Txt>
      </View>
    </Pressable>
  );
}
