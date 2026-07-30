/**
 * Validation for assignments.
 *
 * `chores.assignment` is jsonb behind a `kind`-only CHECK constraint, so a row
 * with a `rotate` kind and a missing or malformed `cadence` was reaching
 * `turnFor`, falling through to `assertNever`, and throwing — which takes down
 * the whole agenda render rather than one row. `schema.ts` next door claimed to
 * be "the single validation point"; it only covered `schedule`.
 *
 * Applied on read and on write, same as the schedule schema.
 */

import { z } from 'zod';

import { tryCivilDate } from '../civil/date';
import type { CivilDate } from '../civil/types';
import type { Assignment } from './types';

const civilDateSchema = z
  .string()
  .refine((value) => tryCivilDate(value) !== null, {
    message: 'Expected a real calendar date in YYYY-MM-DD form',
  })
  .transform((value) => value as CivilDate);

/** A member id. UUIDs today, but the engine only requires a non-empty string. */
const memberIdSchema = z.string().min(1).max(64);

const cadenceSchema = z.discriminatedUnion('unit', [
  z.object({ unit: z.literal('occurrence'), every: z.number().int().min(1).max(52) }),
  z.object({ unit: z.literal('week'), every: z.number().int().min(1).max(52) }),
  z.object({ unit: z.literal('month'), every: z.number().int().min(1).max(24) }),
]);

const segmentSchema = z.object({
  effectiveFrom: civilDateSchema,
  // A rotation with an empty roster cannot assign anybody, which the engine
  // reports as `unassignable` — better to reject it at the boundary.
  memberIds: z
    .array(memberIdSchema)
    .min(1, 'A rotation needs at least one person')
    .refine((ids) => new Set(ids).size === ids.length, 'The same person cannot appear twice'),
  offset: z.number().int().min(0),
});

export const assignmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('anyone') }),
  z.object({ kind: z.literal('fixed'), memberId: memberIdSchema }),
  z.object({ kind: z.literal('everyone') }),
  z.object({
    kind: z.literal('rotate'),
    cadence: cadenceSchema,
    segments: z
      .array(segmentSchema)
      .min(1, 'A rotation needs at least one segment')
      // Segments are an append-only history and `segmentFor` picks the latest
      // that applies, so out-of-order data is a sign something wrote them wrong.
      .refine(
        (segments) =>
          segments.every((s, i) => {
            const previous = segments[i - 1];
            return previous === undefined || s.effectiveFrom >= previous.effectiveFrom;
          }),
        'Rotation segments must be in chronological order',
      ),
  }),
]);

export function parseAssignment(value: unknown): Assignment {
  return assignmentSchema.parse(value) as Assignment;
}

export function safeParseAssignment(
  value: unknown,
): { success: true; data: Assignment } | { success: false; error: z.ZodError } {
  const result = assignmentSchema.safeParse(value);
  return result.success
    ? { success: true, data: result.data as Assignment }
    : { success: false, error: result.error };
}
