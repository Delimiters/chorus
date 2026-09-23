/**
 * Finding the links in a note, so they can be tapped.
 *
 * Jake: *"I still want the mini chore view with the working note links."* A
 * note saying "order from https://example.com/part-1234" is the most useful
 * thing on the sheet and was plain grey text you had to retype by hand.
 *
 * Pure, and here rather than in the component, because the interesting part is
 * *where a link stops* — and that is a string problem with a dozen edge cases,
 * none of which are worth discovering through a rendered component.
 *
 * ── What counts as a link ─────────────────────────────────────────────────
 *
 * `http://`, `https://`, and a bare `www.`. Deliberately not "anything with a
 * dot in it": household notes are full of "3.5mm", "Aisle 4.B", "call Dr.
 * Miller", and turning those blue would be worse than doing nothing. A scheme
 * or a `www.` is somebody having typed an address on purpose.
 */

/** A run of a note: either plain text, or something tappable. */
export type NoteSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'link'; readonly value: string; readonly href: string };

const PATTERN = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;

/**
 * Trailing punctuation that is almost certainly the sentence's, not the URL's.
 *
 * `https://example.com.` ends a sentence; `https://example.com/a.` almost
 * certainly does too. Brackets are balanced rather than blindly stripped,
 * because a Wikipedia URL really can end in one — `(disambiguation)`.
 */
function trimTrailing(url: string): { url: string; rest: string } {
  let end = url.length;
  while (end > 0) {
    const char = url[end - 1] as string;
    if ('.,;:!?'.includes(char)) {
      end -= 1;
      continue;
    }
    if (char === ')' || char === ']') {
      const open = char === ')' ? '(' : '[';
      const opens = [...url.slice(0, end)].filter((c) => c === open).length;
      const closes = [...url.slice(0, end)].filter((c) => c === char).length;
      if (closes > opens) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return { url: url.slice(0, end), rest: url.slice(end) };
}

/**
 * A note, split into what to render plainly and what to make tappable.
 *
 * Always returns the whole input: concatenating every `value` gives the
 * original string back, so nothing can be silently dropped by a bad regex.
 * A note with no links comes back as a single text segment — or as nothing at
 * all when it is empty, so a caller can test `length === 0`.
 */
export function noteSegments(note: string): readonly NoteSegment[] {
  if (note.length === 0) return [];

  const segments: NoteSegment[] = [];
  let cursor = 0;

  for (const match of note.matchAll(PATTERN)) {
    const start = match.index;
    const raw = match[0];
    const { url, rest } = trimTrailing(raw);

    // A match that trims away to nothing is not a link — "www." on its own.
    if (url.length === 0 || url === 'www.') continue;

    if (start > cursor) segments.push({ kind: 'text', value: note.slice(cursor, start) });
    segments.push({
      kind: 'link',
      value: url,
      // `www.` has no scheme, and a URL opener given one without a scheme
      // either refuses it or treats it as a file path.
      href: url.toLowerCase().startsWith('www.') ? `https://${url}` : url,
    });
    if (rest.length > 0) segments.push({ kind: 'text', value: rest });
    cursor = start + raw.length;
  }

  if (cursor < note.length) segments.push({ kind: 'text', value: note.slice(cursor) });
  return segments;
}
