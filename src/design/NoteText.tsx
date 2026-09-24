/**
 * A note, with its links tappable.
 *
 * Jake: *"I still want the mini chore view with the working note links."* A
 * note reading "order from https://example.com/part-1234" is often the most
 * useful thing on the sheet, and it was grey text you had to retype by hand.
 *
 * ── Why nested `Text` and not a row of views ──────────────────────────────
 *
 * The link has to wrap *with* the sentence around it. Laying the segments out
 * as siblings in a flex row breaks a note into a ragged column the moment one
 * line is too long, and putting each on its own line loses the sentence. React
 * Native reflows nested `Text` as one paragraph, which is the only arrangement
 * that keeps "order from <link> before Friday" reading as a sentence.
 *
 * That has one consequence worth naming: a nested `Text` cannot carry a
 * minimum tap height, so the 44pt rule cannot apply to a link inside a
 * paragraph. `hitSlop` does not help either — it is ignored on nested text.
 * The link is therefore as tall as its line, and the mitigation is that it is
 * never the *only* way to reach anything: the chore's own editor holds the
 * same note as selectable text.
 */

import { Linking, Text } from 'react-native';

import { noteSegments } from '@/core/text/links';

import { Txt } from './components';
import { useColors } from './theme';

interface Props {
  readonly note: string;
  /** Matches the surrounding block; the sheet reads larger than a row. */
  readonly variant?: 'small' | 'body';
  readonly numberOfLines?: number;
}

export function NoteText({ note, variant = 'small', numberOfLines }: Props) {
  const colors = useColors();
  const segments = noteSegments(note);

  if (segments.length === 0) return null;

  return (
    <Txt variant={variant} tone="muted" {...(numberOfLines !== undefined ? { numberOfLines } : {})}>
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          <Text key={index}>{segment.value}</Text>
        ) : (
          <Text
            key={index}
            accessibilityRole="link"
            accessibilityHint="Opens in your browser"
            style={{ color: colors.inkA, textDecorationLine: 'underline' }}
            /*
             * Failure is swallowed deliberately. `openURL` rejects when no app
             * can handle the scheme, and there is nothing useful to say about
             * that on a chore sheet — an unhandled rejection would be a red
             * screen over somebody's note.
             */
            onPress={() => {
              void Linking.openURL(segment.href).catch(() => {});
            }}
          >
            {segment.value}
          </Text>
        ),
      )}
    </Txt>
  );
}
