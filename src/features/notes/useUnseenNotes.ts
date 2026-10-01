/**
 * The badge on the Notes tab, and the two things that clear it.
 *
 * Deliberately a hook over the existing notes query rather than a count of its
 * own: the tab bar and the board share one cache entry, so the badge follows a
 * realtime invalidation without a second fetch, and cannot disagree with the
 * list it is counting.
 *
 * Every timestamp here comes off a note — a Postgres `now()` — and none from
 * this phone's clock. See `latestNoteStamp` for why that distinction is the
 * whole design.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { countUnseenNotes, latestNoteStamp, noteBadge } from '@/core/notes/unseen';
import { useNoteList, useNotes } from '@/data/hooks/useNotes';
import { useLastSeenNotes, useNoteSeenStore } from '@/stores/noteSeenStore';
import { useUserId } from '@/stores/sessionStore';

/**
 * Earlier than any timestamp Postgres will produce, and a valid ISO-8601 so it
 * compares as a string like everything else. Means "this board was seen while
 * it was empty".
 */
const EPOCH = '0000-01-01T00:00:00.000Z';

/**
 * What the tab should show — `null` for no badge.
 *
 * Also where a phone that has never seen the board gets its starting point.
 * The tab bar is mounted for the whole life of the app, so this is the first
 * place a list of notes is in hand, and seeding from the newest one means every
 * note that predates the install counts as read — without asking the device
 * what time it is.
 */
export function useNoteBadge(): string | null {
  const query = useNotes();
  const notes = useNoteList();
  const userId = useUserId();
  const lastSeenAt = useLastSeenNotes();
  const markSeen = useNoteSeenStore((s) => s.markSeen);
  const hydrated = useNoteSeenStore((s) => s.hydrated);

  /*
   * `isSuccess`, which is what "the board has been fetched" actually means.
   *
   * `!isLoading` is not that. `useNotes` uses `skipToken` while there is no
   * household, and a disabled query in TanStack v5 is `pending` with
   * `fetchStatus: 'idle'` — so `isLoading` is false, `error` is null and `data`
   * is undefined. "No household yet" was therefore indistinguishable from
   * "empty board", and the sentinel below would have been persisted against it;
   * the real board then arrives with every note newer than the sentinel, which
   * is a `9+` on a fresh install — exactly the noise the seeding exists to
   * prevent.
   *
   * Unreachable today only because `(app)/_layout.tsx` holds a loading screen
   * until the household resolves, so the tab bar never mounts in that state.
   * That is a load-bearing invariant two files away with nothing recording it.
   */
  const loaded = query.isSuccess;
  const latest = latestNoteStamp(notes);

  /*
   * Seed once, and seed an **empty** board too.
   *
   * The first version only seeded when there was a note to seed from, which
   * meant a brand-new household — empty board, the common first-run state —
   * stayed at `null` forever. The first note your housemate ever wrote then
   * went unbadged: the render that saw it still had `lastSeenAt` null (count
   * zero), and the effect seeded straight to that note's own stamp, so it was
   * marked seen without ever having been shown. Every note after it badged
   * correctly, which is the kind of bug nobody reports.
   *
   * The sentinel is a timestamp every real one exceeds, so an empty board is
   * recorded as *seen and empty* rather than as *not yet asked*.
   */
  useEffect(() => {
    if (!hydrated || lastSeenAt !== null || !loaded) return;
    markSeen(latest ?? EPOCH);
  }, [hydrated, lastSeenAt, latest, loaded, markSeen]);

  return noteBadge(countUnseenNotes(notes, { userId, lastSeenAt }));
}

/**
 * Mark the board seen, for the screen that shows it.
 *
 * Gated on **focus**, not on being mounted, and that distinction is the whole
 * hook. A tab screen stays mounted after you leave it, so an effect keyed only
 * on the note list marks the board seen the instant a note arrives over
 * realtime — while you are on Today, looking at the badge that just failed to
 * appear. The first version did exactly that, and the wiring test passed
 * against a board whose focus effect had been deleted, because the other effect
 * was doing the work.
 *
 * Gated on the list having actually arrived, too. An errored board is not an
 * empty one: clearing the badge for three notes whose fetch failed loses them,
 * and `markSeen` only moves forward, so nothing brings them back.
 *
 * Both triggers are needed. Focus, obviously. And the note list *while*
 * focused: a note arriving as you read the board should not badge a tab you
 * are already looking at.
 */
export function useMarkNotesSeen(): void {
  const notes = useNotes();
  const markSeen = useNoteSeenStore((s) => s.markSeen);
  const hydrated = useNoteSeenStore((s) => s.hydrated);

  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const readable = !notes.isLoading && notes.error === null;
  const latest = latestNoteStamp(notes.data ?? []);

  useEffect(() => {
    // Before hydrate, `lastSeenAt` is null and a mark would race whatever is
    // still being read off disk.
    if (!focused || !hydrated || !readable || latest === null) return;
    markSeen(latest);
  }, [focused, hydrated, readable, latest, markSeen]);
}
