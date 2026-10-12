/**
 * The structure of a note: paragraphs, bullets, numbered lists.
 *
 * Jake: *"The notes feature is too simplistic. It needs to be a full featured
 * note experience ... At a minimum it needs clickable links and bullet points
 * and numbered lists."*
 *
 * ── Why markup in the body, and not a document model ──────────────────────
 *
 * The note stays one `text` column holding exactly what somebody typed. The
 * alternative — a JSON document of blocks and marks — buys nested formatting
 * nobody asked for and costs a migration, a schema the editor has to maintain,
 * and a note that is unreadable the moment anything but this app touches it.
 * It would also throw away every note already written.
 *
 * So the markup is the convention people already type into a notes field: a
 * dash for a bullet, `1.` for a numbered list. Nothing has to be learned, and a
 * note with no markup at all is still exactly a paragraph of text. Links need
 * no markup either — `core/text/links.ts` finds them in prose.
 *
 * ── What is deliberately not here ─────────────────────────────────────────
 *
 * No bold, italic, headings, checkboxes, or nesting. Jake drew that line
 * himself — *"doesn't necessarily need to go quite as far as like the iOS notes
 * app"* — and every one of those needs an editing affordance to be discoverable,
 * which is a bigger feature than the one that was asked for. Checkboxes in
 * particular would be a second, worse version of a chore.
 *
 * Pure and `Date`-free, like everything in `core`: the interesting part is where
 * a list starts and stops, which is a string problem with edge cases best found
 * in a test rather than in a rendered screen.
 */

import { noteSegments, type NoteSegment } from './links';

/** One line of a list, already split into tappable and plain runs. */
export interface NoteListItem {
  readonly spans: readonly NoteSegment[];
  /** The number shown, for an ordered list. Bullets ignore it. */
  readonly number: number;
  /**
   * How far the line was indented, 0 for the outer level.
   *
   * Emily's real note is an outline pasted out of OneNote — tab-indented, with
   * `•` at one level, `○` at the next and `§` below that. Flattening it to one
   * level would throw away the only thing that says which bill belongs to which
   * month, so the depth is carried and the renderer indents by it.
   */
  readonly depth: number;
  /**
   * `null` for an ordinary bullet; a box for `- [ ]` / `- [x]`.
   *
   * Her note is full of them, and rendering the brackets literally — "• [ ]
   * wash blankets" — would be showing her the syntax of whatever app she pasted
   * from. **Display only**: they are not tappable, because a checkbox somebody
   * can tick is a chore, and this app already has chores. Ticking one here
   * would be a second, worse version of that with no history and no rotation.
   */
  readonly checked: boolean | null;
}

export type NoteBlock =
  /** Prose. Keeps its own line breaks — notes are written with them. */
  | { readonly kind: 'paragraph'; readonly spans: readonly NoteSegment[] }
  | { readonly kind: 'bullets'; readonly items: readonly NoteListItem[] }
  | { readonly kind: 'numbers'; readonly items: readonly NoteListItem[] };

/**
 * A bullet, at any indent, in whatever the thing you pasted from calls a bullet.
 *
 * Three real sources, all of which turned up in this household's first week:
 *
 * - **typed**: `-`, `*`
 * - **OneNote**, which is what Emily pasted: `•` at level one, `○` at level
 *   two, `§` below that, tab-indented. Reading its glyphs is what makes her
 *   outline render as an outline rather than as one grey block.
 * - **iOS Notes**, which Jake asked for by name — *"when you pasted something
 *   in from ios notes it kind of intelligently turned the checklist markup that
 *   copies over into bullet points"*. Copying a checklist out of it yields
 *   ballot boxes and check marks as the marker, and copying a plain list yields
 *   `◦` or a dash.
 *
 * Dashes include the en and em dash, because that is what Notes and Word write
 * when autocorrect has been at a hyphen. A line of prose that opens with an em
 * dash loses to this, which is the right trade in a notes field.
 *
 * The space is required, so "3-4 bags" and "*not* the big one" stay prose. A
 * marker with nothing after it is an empty bullet somebody is in the middle of
 * typing, so that counts too.
 */
const BULLET = /^([ \t]*)([-*•○▪§‣◦⁃–—☐☑☒✓✔✗✘])(?:[ \t]+(.*))?$/;

/** `[ ]`, `[x]` or `[X]` straight after a bullet's marker. */
const CHECKBOX = /^\[([ xX])\][ \t]*(.*)$/;

/**
 * Markers that are themselves a checkbox, from a pasted checklist.
 *
 * Mapped rather than passed through, so a list pasted from Notes reads the same
 * as one typed as `- [ ]` here.
 *
 * `✗` and `✘` are bullets above but deliberately **absent** here: they mean
 * "done" in some apps and "skipped" in others, so they keep the line and lose
 * only the claim about its state. A box drawn the wrong way round is worse than
 * a plain dot.
 */
const BOX_MARKERS: Record<string, boolean> = {
  '☐': false,
  '☑': true,
  '☒': true,
  '✓': true,
  '✔': true,
};

/**
 * How deep a line is indented, as a level rather than a character count.
 *
 * A tab is one level, two spaces are one level — the two conventions people
 * actually paste. Capped, because an outline indented nine deep would push its
 * text off a phone and the information is in the *order* by then, not the inset.
 */
const MAX_DEPTH = 4;

function depthOf(indent: string): number {
  let level = 0;
  let spaces = 0;
  for (const ch of indent) {
    if (ch === '\t') level += 1;
    else {
      spaces += 1;
      if (spaces === 2) {
        level += 1;
        spaces = 0;
      }
    }
  }
  return Math.min(level, MAX_DEPTH);
}

/**
 * A number, then a dot or paren, then a space: `1. milk`, `2) eggs`.
 *
 * Three digits at most, because the only four-digit number anybody starts a
 * line with is a year: "2026. What a year" is prose, not item two thousand and
 * twenty-six. It costs a list that reaches a thousand items, which no note on
 * this household's board is going to be.
 */
const NUMBER = /^([ \t]*)(\d{1,3})[.)](?:[ \t]+(.*))?$/;

/**
 * Line endings, normalised before anything looks at a line.
 *
 * A note pasted from a browser or a Windows machine arrives with `\r\n`, and
 * `.` in a regex does not match `\r` — so "- milk\r" failed the bullet pattern
 * and the whole list rendered as prose. Splitting on `\n` alone also leaves a
 * stray `\r` at the end of every line, which is an invisible character in the
 * middle of somebody's note.
 */
function lines(note: string): string[] {
  return note.replace(/\r\n?/g, '\n').split('\n');
}

interface Line {
  readonly kind: 'bullet' | 'number' | 'text' | 'blank';
  /** For rendering: the text with the marker *and* any `[ ]` taken off. */
  readonly content: string;
  /**
   * For rewriting: everything after the marker, **verbatim**.
   *
   * The two are different and the difference is somebody's note. A review found
   * the list buttons rebuilding a line from `content`, which had already lost
   * the `[ ]` and the leading tabs — so one tap on Emily's pasted checklist
   * turned "- [ ] water plants" into "water plants" and flattened her outline a
   * level, as a permanent write with no undo. Rewrites use this; only the
   * renderer uses `content`.
   */
  readonly rest: string;
  /** The original leading whitespace, so a rewrite can put it back. */
  readonly indent: string;
  readonly number: number;
  readonly depth: number;
  readonly checked: boolean | null;
}

/**
 * A capture group the pattern guarantees.
 *
 * `noUncheckedIndexedAccess` types every group as possibly absent, and the
 * `?? ''` that satisfies it is a branch no input can take — the groups below are
 * not optional in their patterns, so a match always fills them. Four dead
 * branches were enough to drop this file under its coverage gate, which is the
 * gate doing its job: untestable code is code to remove, not to test.
 */
function group(match: RegExpExecArray, index: number): string {
  return match[index] as string;
}

function classify(line: string): Line {
  const bullet = BULLET.exec(line);
  if (bullet !== null) {
    const indent = group(bullet, 1);
    const marker = group(bullet, 2);
    // Group 3 *is* optional — "- " with nothing after it is a bullet being
    // typed — so this fallback is reachable and stays.
    const body = bullet[3] ?? '';
    const box = CHECKBOX.exec(body);
    const fromMarker = BOX_MARKERS[marker];
    /*
     * `§` only counts when the line is indented.
     *
     * It earns its place from OneNote's third level, where it always sits
     * behind tabs. Unindented, a line opening with it is far more likely to be
     * prose — "§ 12 of the lease says no pets" — and turning that into a bullet
     * would eat the section sign.
     */
    if (marker === '§' && indent === '') {
      return {
        kind: 'text',
        content: line,
        rest: line,
        indent: '',
        number: 0,
        depth: 0,
        checked: null,
      };
    }
    return {
      kind: 'bullet',
      content: box === null ? body : group(box, 2),
      rest: body,
      indent,
      number: 0,
      depth: depthOf(indent),
      // `- [x]` written here wins over the marker, because it is the more
      // specific statement; otherwise a pasted box carries its own state.
      checked: box !== null ? group(box, 1) !== ' ' : (fromMarker ?? null),
    };
  }

  const numbered = NUMBER.exec(line);
  if (numbered !== null) {
    const body = numbered[3] ?? '';
    // The same checkbox reading as a bullet gets, so "1. [ ] thing" does not
    // print the brackets it understood.
    const box = CHECKBOX.exec(body);
    return {
      kind: 'number',
      content: box === null ? body : group(box, 2),
      rest: body,
      indent: group(numbered, 1),
      number: Number(group(numbered, 2)),
      depth: depthOf(group(numbered, 1)),
      checked: box === null ? null : group(box, 1) !== ' ',
    };
  }

  return {
    kind: line.trim() === '' ? 'blank' : 'text',
    content: line,
    rest: line.trimStart(),
    indent: line.slice(0, line.length - line.trimStart().length),
    number: 0,
    depth: 0,
    checked: null,
  };
}

/**
 * A note, as blocks.
 *
 * Consecutive list lines of the same kind become one list; consecutive prose
 * lines become one paragraph with its newlines intact, because a note's line
 * breaks are information — an address, a shopping list somebody wrote without
 * dashes — and rendering each line as its own block would double the spacing
 * between them.
 *
 * Numbers are renumbered from the first item of each list rather than taken
 * from the text, so a list typed `1. 1. 1.` reads 1, 2, 3 and one typed
 * `3. 4. 5.` keeps starting at 3. That is the behaviour of every editor people
 * have used, and it means inserting a line in the middle does not leave the
 * rest wrong.
 *
 * An empty note is no blocks, so a caller can test `length === 0`.
 */
export function noteBlocks(note: string): readonly NoteBlock[] {
  if (note.trim() === '') return [];

  const blocks: NoteBlock[] = [];
  let prose: string[] = [];
  let items: NoteListItem[] = [];
  let listKind: 'bullets' | 'numbers' | null = null;
  let listStart = 1;

  const flushProse = (): void => {
    if (prose.length === 0) return;
    blocks.push({ kind: 'paragraph', spans: noteSegments(prose.join('\n')) });
    prose = [];
  };

  const flushList = (): void => {
    if (listKind === null || items.length === 0) {
      listKind = null;
      items = [];
      return;
    }
    blocks.push({ kind: listKind, items });
    listKind = null;
    items = [];
  };

  for (const raw of lines(note)) {
    const line = classify(raw);

    if (line.kind === 'blank') {
      flushProse();
      flushList();
      continue;
    }

    if (line.kind === 'text') {
      flushList();
      prose.push(line.content);
      continue;
    }

    const wanted = line.kind === 'bullet' ? 'bullets' : 'numbers';
    if (listKind !== wanted) {
      flushProse();
      flushList();
      listKind = wanted;
      // An ordered list keeps the number it was started at and counts on from
      // there; a list starting "3." was almost certainly continuing something.
      listStart = line.kind === 'number' ? line.number : 1;
    }
    items.push({
      spans: noteSegments(line.content),
      number: listStart + items.length,
      depth: line.depth,
      checked: line.checked,
    });
  }

  flushProse();
  flushList();
  return blocks;
}

/** Which marker a list button applies. */
export type ListKind = 'bullets' | 'numbers';

/**
 * Turning the line the cursor is on into a list item, or back into prose.
 *
 * The string half of the editor's two list buttons, here because it is all edge
 * cases — where the line starts, what is already on it, where the cursor should
 * end up — and none of them are worth finding through a keyboard.
 *
 * It toggles: pressing the bullet button on a line that is already a bullet
 * takes the marker off. Pressing the *other* button swaps the marker rather
 * than stacking one on the other, which is what every editor does and what
 * anybody would expect from two buttons sitting side by side.
 *
 * The number is the previous list item's plus one, so pressing it down a list
 * counts up rather than writing "1." five times. `noteBlocks` renumbers on
 * render anyway, so this only has to look right while typing.
 *
 * @param text the whole note
 * @param cursor where the caret is, as a character offset
 * @returns the new note and where the caret should sit afterwards
 */
export function toggleListPrefix(
  text: string,
  cursor: number,
  kind: ListKind,
): { readonly text: string; readonly cursor: number } {
  const at = Math.max(0, Math.min(cursor, text.length));
  const start = text.lastIndexOf('\n', at - 1) + 1;
  const nextBreak = text.indexOf('\n', at);
  const end = nextBreak === -1 ? text.length : nextBreak;
  const line = text.slice(start, end);

  const current = classify(line);
  const isAlready =
    (kind === 'bullets' && current.kind === 'bullet') ||
    (kind === 'numbers' && current.kind === 'number');

  const replace = (body: string): { text: string; cursor: number } => ({
    text: text.slice(0, start) + body + text.slice(end),
    // Keep the caret the same distance from the end of the line, so pressing a
    // button mid-word does not drop the caret somewhere else in the sentence.
    cursor: Math.max(start, start + body.length - (end - at)),
  });

  /*
   * Built from `indent` + `rest`, never from `content`.
   *
   * `rest` is everything after the marker exactly as it was typed, so a `[ ]`
   * survives a marker swap and a pasted outline keeps its level. Rebuilding
   * from `content` is what stripped both.
   */
  const keep = current.indent + current.rest;

  // Off: the marker goes, the indent and the rest stay.
  if (isAlready) return replace(keep);

  if (kind === 'bullets') return replace(`${current.indent}- ${current.rest}`);

  /*
   * The next number in the run above, so holding the button down a list counts
   * up. Only an unbroken run of numbered lines counts: a blank line or a
   * paragraph means a new list starting at one.
   */
  let previous = 0;
  let scan = start - 1;
  while (scan > 0) {
    const lineStart = text.lastIndexOf('\n', scan - 1) + 1;
    const above = classify(text.slice(lineStart, scan));
    if (above.kind !== 'number') break;
    previous = above.number;
    break;
  }

  return replace(`${current.indent}${String(previous + 1)}. ${current.rest}`);
}

/**
 * A note flattened for a two-line card preview.
 *
 * The markers come off: a card reading "- milk" is showing its own syntax,
 * which is the sort of leak that makes a feature feel unfinished. Blank lines
 * collapse too, because two of them in a 200-character preview waste a third of
 * it.
 *
 * Deliberately not the parser's output — a preview has no blocks, only a line
 * or two of what the note says.
 */
export function notePreview(note: string): string {
  return lines(note)
    .map((line) => {
      const parsed = classify(line);
      return parsed.kind === 'bullet' || parsed.kind === 'number' ? parsed.content : line;
    })
    .filter((line) => line.trim() !== '')
    .join('\n');
}
