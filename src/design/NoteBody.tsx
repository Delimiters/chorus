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
import { space } from './tokens';

interface Props {
  readonly note: string;
  readonly variant?: 'small' | 'body';
}

/**
 * A floor for the marker column, not a fixed width.
 *
 * It was fixed at 26, which a review measured against `100.` at body size — about
 * 29pt — so a three-digit item wrapped its own marker onto a second line and the
 * text beside it sat misaligned. Nothing in this app sets `allowFontScaling`
 * either, so at the largest accessibility sizes even `•` outgrew the box.
 * `minWidth` lets the column take what it needs; the text after it still starts
 * at the same place for every row of a normal list.
 */
const MARKER_MIN_WIDTH = 26;

/**
 * How far each indent level insets.
 *
 * Small on purpose: Emily's pasted outline goes four levels deep, and at the
 * usual 24pt that would push the deepest text into a column two words wide on
 * an iPhone 14.
 */
const INDENT = 14;

/**
 * A different dot per level, cycling.
 *
 * Emily's pasted outline goes three deep, and at 14pt of inset per level the
 * indent alone is a weak signal — two levels look like a ragged edge. Varying
 * the glyph is what every outliner does, and it is the difference between
 * reading the shape and counting pixels. It also happens to echo what OneNote
 * wrote in the first place.
 *
 * Five of them, one per level the parser admits: with three, depth 0 and depth 3
 * drew the same dot and were told apart only by inset — and Emily's outline goes
 * to depth 3.
 */
const DOTS = ['•', '◦', '▪', '‣', '·'] as const;

/**
 * What goes in the marker column.
 *
 * A function rather than a nested ternary, because the first version of that
 * put `checked === null` first and made the depth glyph unreachable — four
 * branches on two fields is one more than a conditional expression reads
 * clearly at.
 *
 * A box for a checklist item, a dot for a plain bullet. Drawn, never tapped: a
 * checkbox somebody can tick is a chore, and this app has chores — one here
 * would be a second, worse version with no history and no rotation.
 */
function markerFor(
  kind: 'bullets' | 'numbers',
  item: { readonly number: number; readonly depth: number; readonly checked: boolean | null },
): string {
  if (kind === 'numbers') return `${String(item.number)}.`;
  if (item.checked === true) return '☑';
  if (item.checked === false) return '☐';
  return DOTS[item.depth % DOTS.length] ?? '•';
}

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
              <View
                key={row}
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  paddingLeft: item.depth * INDENT,
                }}
              >
                {/*
                  Wrapped so the glyph can be hidden from a screen reader —
                  `Txt` does not forward accessibility props, and VoiceOver
                  otherwise stops on every marker and announces "ballot box with
                  check" before each item. The state it carries is in the item's
                  own label beside it.
                */}
                <View accessibilityElementsHidden importantForAccessibility="no">
                  <Txt
                    variant={variant}
                    tone="muted"
                    numberOfLines={1}
                    style={{
                      minWidth: MARKER_MIN_WIDTH,
                      textAlign: block.kind === 'numbers' ? 'right' : 'left',
                      paddingRight: space.xs,
                      // Tabular so a column of numbers lines up on the dot.
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {markerFor(block.kind, item)}
                  </Txt>
                </View>
                {/*
                  `flex: 1` with `minWidth: 0` so a long item wraps inside its
                  own column instead of pushing the row wider than the screen —
                  the same pair the plan's rows need for a long chore name.
                */}
                <Txt
                  variant={variant}
                  /*
                    The state in words, because the box is hidden above and
                    strikethrough reaches no screen reader at all.
                  */
                  {...(item.checked === null
                    ? {}
                    : {
                        accessibilityLabel: `${item.checked ? 'Done' : 'Not done'}: ${item.spans
                          .map((s) => s.value)
                          .join('')}`,
                      })}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    /*
                      A ticked item reads as done without being interactive.
                      `textMuted`, not `textFaint`: a review measured faint at
                      3.69:1 on paper, under the 4.5:1 this text size needs.
                      Muted is 7.8:1 and still visibly stepped back.
                    */
                    ...(item.checked === true
                      ? { textDecorationLine: 'line-through', color: colors.textMuted }
                      : {}),
                  }}
                >
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
