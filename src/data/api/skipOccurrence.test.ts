/**
 * What "Skip it" does when something already exists for that occurrence.
 *
 * A review found this path had no coverage of any kind — reverting the fix
 * left the whole suite green. It matters because the failure is silent: the
 * sheet closes and the chore is not skipped.
 *
 * A duplicate used to be mapped to success outright, which is right for the
 * case it was written for (a double tap, or a retry after a timeout) and wrong
 * across two phones: Jake moves Thursday's dishes, Emily's screen has not
 * refreshed, she taps "Skip it", and the chore goes to Friday instead. The
 * sheet hides the action once a row is skipped or moved, so this is
 * unreachable on one device and ordinary on two.
 */

import { skipOccurrence } from './chores';

const DUPLICATE = { code: '23505', message: 'duplicate key value' };

let mockInsertError: { code: string; message: string } | null = null;
let mockExisting: { kind: string } | null = null;
let mockReadError: { code?: string; message: string } | null = null;

jest.mock('../supabase', () => ({
  describeError: (e: { message: string }) => e.message,
  // The real one, kept honest: 23505 is what the unique index raises.
  isDuplicate: (e: { code?: string } | null) => e?.code === '23505',
  supabase: {
    from: () => ({
      insert: () => Promise.resolve({ error: mockInsertError }),
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: mockExisting, error: mockReadError }),
          }),
        }),
      }),
    }),
  },
}));

const input = {
  householdId: 'house-1',
  choreId: 'dishes',
  occurrenceKey: 'v1:dishes:2026-09-29',
  dueOn: '2026-09-29' as never,
  userId: 'me',
};

beforeEach(() => {
  mockInsertError = null;
  mockExisting = null;
  mockReadError = null;
});

describe('skipping an occurrence', () => {
  it('succeeds when the insert goes through', async () => {
    await expect(skipOccurrence(input)).resolves.toBeUndefined();
  });

  it('treats a repeat of the same skip as success', async () => {
    // A double tap, or a retry after a timeout, is one skip and not an error.
    mockInsertError = DUPLICATE;
    mockExisting = { kind: 'skip' };

    await expect(skipOccurrence(input)).resolves.toBeUndefined();
  });

  it('refuses to claim a skip when the occurrence was moved instead', async () => {
    /*
     * The two-phone case, and the whole point. Silently succeeding here is the
     * documented "a chore that cannot be skipped and never says why".
     */
    mockInsertError = DUPLICATE;
    mockExisting = { kind: 'reschedule' };

    await expect(skipOccurrence(input)).rejects.toThrow(/moved this to another day/i);
  });

  it('does not map a failed read to success', async () => {
    /*
     * The follow-up SELECT's own error used to be discarded, so a dropped
     * request produced `data: null` and fell into the success branch — the
     * same silent no-op, moved one line down.
     */
    mockInsertError = DUPLICATE;
    mockReadError = { message: 'Network request failed' };

    await expect(skipOccurrence(input)).rejects.toThrow(/Network request failed/);
  });

  it('does not claim a skip for a duplicate it cannot see', async () => {
    // `exceptions_insert` needs only household membership while
    // `exceptions_select` also requires the chore to be visible, so a row can
    // exist and be invisible to the reader.
    mockInsertError = DUPLICATE;
    mockExisting = null;

    await expect(skipOccurrence(input)).rejects.toThrow(/already exists/i);
  });

  it('still reports an insert error that is not a duplicate', async () => {
    mockInsertError = { code: '42501', message: 'permission denied' };

    await expect(skipOccurrence(input)).rejects.toThrow(/permission denied/);
  });
});
