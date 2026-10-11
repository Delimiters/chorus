/**
 * A note as it reads: paragraphs, bullets, numbered lists, tappable links.
 *
 * Jake: *"At a minimum it needs clickable links and bullet points and numbered
 * lists."* The parsing is in `core/text/notes.ts`; this is only the layout, so
 * that where a list starts and stops stays testable without a renderer.
 *
 * ── Why a row per item and nested `Text` inside it ────────────────────────
 *
 * A list item is a marker and a line of prose that has to wrap *under itself*,
 * not under the marker. That needs the marker and the text as flex siblings
 * with the text free to grow — and the text's own runs nested so a link reflows
 * inside the sentence rather than breaking the line. `NoteText` makes the same
 * argument for prose and they share `NoteSpans`.
 *
 * The marker column is a fixed width with the number right-aligned in it, so
 * "9." and "10." put their text at the same place instead of stepping a
 * character to the right at ten.
 */

import { View } from 'react-native';

import { noteBlocks } from '@/core/text/notes';

import { Txt } from './components';
import { NoteSpans } from './NoteText';
import { useColors } from './theme';
import { space, type } from './tokens';

interface Props {
  readonly note: string;
  readonly variant?: 'small' | 'body';
}

/** Wide enough for "100." at body size, so the text column never moves. */
const MARKER_WIDTH = 26;

export function NoteBody({ note, variant = 'body' }: Props) {
  const colors = useColors();
  const blocks = noteBlocks(note);

  if (blocks.length === 0) return null;

  return (
    <View style={{ gap: space.sm }}>
      {blocks.map((block, index) => {
        if (block.kind === 'paragraph') {
          return (
            <Txt key={index} variant={variant}>
              <NoteSpans spans={block.spans} linkColor={colors.inkA} />
            </Txt>
          );
        }

        return (
          <View key={index} style={{ gap: space.xs }}>
            {block.items.map((item, row) => (
              <View key={row} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <Txt
                  variant={variant}
                  tone="muted"
                  style={{
                    width: MARKER_WIDTH,
                    textAlign: block.kind === 'numbers' ? 'right' : 'left',
                    paddingRight: space.xs,
                    // Tabular so a column of numbers lines up on the dot.
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {block.kind === 'numbers' ? `${String(item.number)}.` : '•'}
                </Txt>
                {/*
                  `flex: 1` with `minWidth: 0` so a long item wraps inside its
                  own column instead of pushing the row wider than the screen —
                  the same pair the plan's rows need for a long chore name.
                */}
                <Txt variant={variant} style={{ flex: 1, minWidth: 0 }}>
                  <NoteSpans spans={item.spans} linkColor={colors.inkA} />
                </Txt>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

/** The line height the body text uses, for anything sizing around it. */
export const NOTE_LINE_HEIGHT = (type.body as { lineHeight?: number }).lineHeight ?? 22;
