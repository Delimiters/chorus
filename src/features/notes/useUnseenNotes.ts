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
 * What the tab should show — `null` for no badge.
 *
 * Also where a phone that has never seen the board gets its starting point.
 * The tab bar is mounted for the whole life of the app, so this is the first
 * place a list of notes is in hand, and seeding from the newest one means every
 * note that predates the install counts as read — without asking the device
 * what time it is.
 */
export function useNoteBadge(): string | null {
  const notes = useNoteList();
  const userId = useUserId();
  const lastSeenAt = useLastSeenNotes();
  const markSeen = useNoteSeenStore((s) => s.markSeen);
  const hydrated = useNoteSeenStore((s) => s.hydrated);

  const latest = latestNoteStamp(notes);

  useEffect(() => {
    if (!hydrated || lastSeenAt !== null || latest === null) return;
    markSeen(latest);
  }, [hydrated, lastSeenAt, latest, markSeen]);

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
