/**
 * The shared note board.
 *
 * Household-wide on every verb, so either person can write, fix or clear any
 * note. That is the same trust posture as completions and plan entries, and
 * the opposite of routines — a note board where you cannot fix your
 * housemate's typo is not a shared note board.
 *
 * Nothing here is optimistic. A note is free text somebody is in the middle of
 * writing, and patching a cache with a half-typed body — then rolling it back
 * on a failed save — would lose keystrokes. The list is small and the writes
 * are rare.
 */

import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createNote, deleteNote, listNotes, updateNote, type Note } from '../api/notes';
import { qk } from '../queryKeys';
import { useActiveHouseholdId, useUserId } from '@/stores/sessionStore';

const EMPTY: readonly Note[] = [];

export function useNotes() {
  const householdId = useActiveHouseholdId();
  return useQuery({
    queryKey: qk.notes(householdId ?? '__none__'),
    queryFn: householdId === null ? skipToken : () => listNotes(householdId),
  });
}

/** The list itself, for a screen that only wants to render it. */
export function useNoteList(): readonly Note[] {
  return useNotes().data ?? EMPTY;
}

function useInvalidateNotes() {
  const householdId = useActiveHouseholdId();
  const queryClient = useQueryClient();
  return async () => {
    if (householdId === null) return;
    await queryClient.invalidateQueries({ queryKey: qk.notes(householdId) });
  };
}

export function useCreateNote() {
  const householdId = useActiveHouseholdId();
  const userId = useUserId();
  const invalidate = useInvalidateNotes();

  return useMutation({
    mutationFn: async (input: { title: string | null; body: string }) => {
      if (householdId === null || userId === null) throw new Error('Please sign in again.');
      return createNote({ householdId, userId, title: input.title, body: input.body });
    },
    onSettled: invalidate,
  });
}

export function useUpdateNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (input: { id: string; title: string | null; body: string }) => updateNote(input),
    onSettled: invalidate,
  });
}

export function useDeleteNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (id: string) => deleteNote(id),
    onSettled: invalidate,
  });
}
