import { countUnseenNotes, noteBadge, type SeenCandidate } from './unseen';

const ME = 'me';
const THEM = 'them';

function note(updatedBy: string | null, updatedAt: string): SeenCandidate {
  return { updatedBy, updatedAt };
}

describe('countUnseenNotes', () => {
  const seen = '2026-09-30T12:00:00.000Z';

  it('counts a housemate edit made after you last looked', () => {
    expect(
      countUnseenNotes([note(THEM, '2026-09-30T12:00:01.000Z')], { userId: ME, lastSeenAt: seen }),
    ).toBe(1);
  });

  it('ignores an edit made before you last looked', () => {
    expect(
      countUnseenNotes([note(THEM, '2026-09-30T11:59:59.000Z')], { userId: ME, lastSeenAt: seen }),
    ).toBe(0);
  });

  it('ignores your own edits, however recent', () => {
    expect(
      countUnseenNotes([note(ME, '2026-10-01T09:00:00.000Z')], { userId: ME, lastSeenAt: seen }),
    ).toBe(0);
  });

  /*
   * The fixture that makes this non-vacuous: three notes, and each of the
   * three reasons to exclude one is represented. A fixture of one unseen note
   * would pass against a function that returned `notes.length`.
   */
  it('counts only the notes that are both somebody else’s and new', () => {
    const notes = [
      note(THEM, '2026-09-30T12:00:01.000Z'),
      note(THEM, '2026-09-30T13:00:00.000Z'),
      note(ME, '2026-09-30T14:00:00.000Z'),
      note(THEM, '2026-09-29T08:00:00.000Z'),
    ];
    expect(countUnseenNotes(notes, { userId: ME, lastSeenAt: seen })).toBe(2);
  });

  it('counts an orphaned note, whose author deleted their account', () => {
    expect(
      countUnseenNotes([note(null, '2026-09-30T12:00:01.000Z')], { userId: ME, lastSeenAt: seen }),
    ).toBe(1);
  });

  it('counts nothing on a device that has never opened the board', () => {
    const notes = [note(THEM, '2026-09-30T12:00:01.000Z'), note(THEM, '2020-01-01T00:00:00.000Z')];
    expect(countUnseenNotes(notes, { userId: ME, lastSeenAt: null })).toBe(0);
  });

  /*
   * Signed out mid-render: `userId` is null and every note is somebody's. The
   * badge is then a number nobody can act on, but it must not throw, and it
   * must not silently treat the orphaned note as yours.
   */
  it('treats every attributed note as somebody else’s when nobody is signed in', () => {
    const notes = [note(THEM, '2026-09-30T12:00:01.000Z'), note(null, '2026-09-30T12:00:02.000Z')];
    expect(countUnseenNotes(notes, { userId: null, lastSeenAt: seen })).toBe(1);
  });

  it('is zero for an empty board', () => {
    expect(countUnseenNotes([], { userId: ME, lastSeenAt: seen })).toBe(0);
  });

  /*
   * Equality, spelled out because `>` versus `>=` decides whether opening the
   * board leaves one note permanently badged. The seen moment is recorded
   * after the list is in hand, so a note stamped at exactly that instant has
   * been seen.
   */
  it('treats a note stamped at the exact moment you looked as seen', () => {
    expect(countUnseenNotes([note(THEM, seen)], { userId: ME, lastSeenAt: seen })).toBe(0);
  });
});

describe('noteBadge', () => {
  it('shows nothing when there is nothing new', () => {
    expect(noteBadge(0)).toBeNull();
  });

  it('never shows a badge for a negative count', () => {
    expect(noteBadge(-1)).toBeNull();
  });

  it('shows the exact number up to nine', () => {
    expect(noteBadge(1)).toBe('1');
    expect(noteBadge(9)).toBe('9');
  });

  it('caps at nine, so the badge cannot widen past the label', () => {
    expect(noteBadge(10)).toBe('9+');
    expect(noteBadge(240)).toBe('9+');
  });
});
