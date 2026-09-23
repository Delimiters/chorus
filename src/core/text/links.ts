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
  /*
   * Counted once, then adjusted as characters come off.
   *
   * The first version re-scanned `url.slice(0, end)` twice per stripped
   * character, which is quadratic in the length of a trailing bracket run.
   * Measured on node: 92ms at 2,000 brackets, 5.2s at 20,000, 30s at 40,000 —
   * bounded in practice only by the 2,000-character cap on a chore note, and
   * `NoteText` calls this in a render body.
   */
  let parens = 0;
  let squares = 0;
  for (const char of url) {
    if (char === '(') parens += 1;
    else if (char === ')') parens -= 1;
    else if (char === '[') squares += 1;
    else if (char === ']') squares -= 1;
  }

  let end = url.length;
  while (end > 0) {
    const char = url[end - 1] as string;
    if ('.,;:!?'.includes(char)) {
      end -= 1;
      continue;
    }
    // Unbalanced closers only. A Wikipedia URL really can end in one —
    // `/wiki/Mercury_(planet)` — so a blind strip gives a link that 404s.
    if (char === ')' && parens < 0) {
      parens += 1;
      end -= 1;
      continue;
    }
    if (char === ']' && squares < 0) {
      squares += 1;
      end -= 1;
      continue;
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

    /*
     * A match that trims down to a scheme or a bare host with nothing after
     * it is not an address: `www..`, `http://.`, `https://,`. The trimming
     * above strips the punctuation and leaves `www`, `http://`, `https://` —
     * none of which any opener can do anything with, and `www` in particular
     * does not start with `www.`, so it would not even get a scheme.
     *
     * The first version tested `url === 'www.'`, which `trimTrailing` can
     * never produce, and `url.length === 0`, which a match starting `h` or `w`
     * cannot reach. Both were dead, and a blue underlined dead link is exactly
     * the shape this file exists to avoid.
     */
    if (!/^(?:https?:\/\/|www\.)./i.test(url)) continue;

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
