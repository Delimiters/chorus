/**
 * The badge on the Notes tab, and the two places that clear it.
 *
 * Deliberately a hook over the existing notes query rather than a count of its
 * own: the tab bar and the board share one cache entry, so the badge follows a
 * realtime invalidation without a second fetch, and cannot disagree with the
 * list it is counting.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { countUnseenNotes, noteBadge } from '@/core/notes/unseen';
import { useNoteList } from '@/data/hooks/useNotes';
import { useLastSeenNotes, useNoteSeenStore } from '@/stores/noteSeenStore';
import { useUserId } from '@/stores/sessionStore';

/** What the tab should show — `null` for no badge. */
export function useNoteBadge(): string | null {
  const notes = useNoteList();
  const userId = useUserId();
  const lastSeenAt = useLastSeenNotes();

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
 * Both triggers are needed. Focus, obviously. And the note list *while*
 * focused: a note arriving as you read the board should not badge a tab you
 * are already looking at.
 *
 * The timestamp is taken at the moment of marking rather than from the newest
 * note, so a note saved a second later is still news. `markSeen` is monotonic,
 * which is what makes firing from two directions safe.
 */
export function useMarkNotesSeen(): void {
  const notes = useNoteList();
  const markSeen = useNoteSeenStore((s) => s.markSeen);
  const hydrated = useNoteSeenStore((s) => s.hydrated);

  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    // Before hydrate, `lastSeenAt` is null and a mark would race the seed —
    // writing a moment, then having the stored value overwrite it.
    if (!focused || !hydrated) return;
    markSeen(new Date().toISOString());
  }, [focused, hydrated, markSeen, notes]);
}
