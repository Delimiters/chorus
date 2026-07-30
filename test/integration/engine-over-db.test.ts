/**
 * Proof that the database and the engine agree.
 *
 * Schedules live in the database as jsonb and are consumed by a pure TypeScript
 * engine that knows nothing about Postgres. Nothing forces those two to stay in
 * step — a migration could write a shape Zod rejects, or the engine could gain a
 * variant the CHECK constraint forbids. This suite reads the real seeded rows and
 * runs the real projector over them.
 *
 * It is the seam between Phase 3 and Phases 1–2, and the only test that would
 * catch a drift between them.
 */

import { civilDate } from '../../src/core/civil/date';
import type { CalendarConfig } from '../../src/core/civil/types';
import { projectOccurrences } from '../../src/core/occurrence/project';
import type { ChoreInput } from '../../src/core/occurrence/types';
import { safeParseSchedule } from '../../src/core/recurrence/schema';
import type { Assignment } from '../../src/core/rotation/types';
import { adminClient } from './clients';

jest.setTimeout(60_000);

/** The seeded household from supabase/seed.sql. */
const HOUSEHOLD = 'a0000000-0000-0000-0000-00000000000a';
const JAKE = '11111111-1111-1111-1111-111111111111';
const SAM = '22222222-2222-2222-2222-222222222222';

const CAL: CalendarConfig = { weekStartsOn: 0 };

/** Reads seeded chores with the admin client — setup, not an assertion target. */
async function loadChores(): Promise<ChoreInput[]> {
  const admin = adminClient();
  const { data, error } = await admin
    .from('chores')
    .select('id, title, schedule, assignment, archived_at')
    .eq('household_id', HOUSEHOLD)
    .order('title');
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const parsed = safeParseSchedule(row.schedule);
    if (!parsed.success) {
      throw new Error(
        `Chore "${row.title}" has a schedule the engine rejects: ` +
          parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '),
      );
    }
    return {
      id: row.id,
      title: row.title,
      schedule: parsed.data,
      assignment: row.assignment as unknown as Assignment,
      archived: row.archived_at !== null,
    };
  });
}

describe('every stored schedule is valid to the engine', () => {
  it('parses all seeded chores without a single Zod failure', async () => {
    // loadChores throws with the offending chore named if any row is invalid.
    const chores = await loadChores();
    expect(chores.length).toBeGreaterThan(0);
  });

  it('covers all eight recurrence kinds', async () => {
    const kinds = new Set((await loadChores()).map((c) => c.schedule.rule.kind));
    expect([...kinds].sort()).toEqual([
      'daily',
      'monthlyByDay',
      'monthlyByWeekday',
      'monthlyFloating',
      'once',
      'unscheduled',
      'weekly',
      'weeklyFloating',
    ]);
  });

  it('covers all four assignment kinds', async () => {
    const kinds = new Set((await loadChores()).map((c) => c.assignment.kind));
    expect([...kinds].sort()).toEqual(['anyone', 'everyone', 'fixed', 'rotate']);
  });

  it('agrees with the generated starts_on column', async () => {
    // starts_on is a generated text column; the engine reads startsOn from the
    // jsonb. If those ever disagree, indexed queries would silently miss rows.
    const admin = adminClient();
    const { data } = await admin
      .from('chores')
      .select('title, schedule, starts_on')
      .eq('household_id', HOUSEHOLD);

    for (const row of data ?? []) {
      const parsed = safeParseSchedule(row.schedule);
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(row.starts_on).toBe(parsed.data.startsOn);
    }
  });
});

describe('projecting real data', () => {
  it('produces a coherent agenda for a real week', async () => {
    const chores = await loadChores();
    const projected = projectOccurrences(
      {
        chores,
        completions: [],
        exceptions: [],
        memberIds: [JAKE, SAM],
        today: civilDate('2026-01-07'),
      },
      CAL,
      { start: civilDate('2026-01-04'), end: civilDate('2026-01-10') },
    );

    expect(projected.length).toBeGreaterThan(0);

    // Every occurrence must fall inside the requested window.
    for (const occ of projected) {
      expect(occ.dueOn >= '2026-01-04').toBe(true);
      expect(occ.dueOn <= '2026-01-10').toBe(true);
    }

    // Keys must be unique — the guard against the prototype's collapse bug,
    // now verified against schedules that came out of Postgres.
    const keys = projected.map((o) => o.occurrenceKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('rotates the seeded trash chore between the two housemates', async () => {
    const chores = (await loadChores()).filter((c) => c.title === 'Take out the trash');
    expect(chores).toHaveLength(1);

    const projected = projectOccurrences(
      {
        chores,
        completions: [],
        exceptions: [],
        memberIds: [JAKE, SAM],
        today: civilDate('2026-01-07'),
      },
      CAL,
      { start: civilDate('2026-01-04'), end: civilDate('2026-01-17') },
    );

    // Mon/Wed/Fri over two weeks, with the turn flipping weekly.
    const summary = projected.map((o) => ({
      due: o.dueOn as string,
      who:
        o.assignee.kind === 'member' ? (o.assignee.memberId === JAKE ? 'jake' : 'sam') : 'anyone',
    }));

    expect(summary).toEqual([
      { due: '2026-01-05', who: 'jake' },
      { due: '2026-01-07', who: 'jake' },
      { due: '2026-01-09', who: 'jake' },
      { due: '2026-01-12', who: 'sam' },
      { due: '2026-01-14', who: 'sam' },
      { due: '2026-01-16', who: 'sam' },
    ]);
  });

  it('fans the seeded laundry chore out to both housemates', async () => {
    const chores = (await loadChores()).filter((c) => c.title === 'Laundry');
    const projected = projectOccurrences(
      {
        chores,
        completions: [],
        exceptions: [],
        memberIds: [JAKE, SAM],
        today: civilDate('2026-01-07'),
      },
      CAL,
      { start: civilDate('2026-01-04'), end: civilDate('2026-01-10') },
    );

    expect(projected).toHaveLength(2);
    expect(projected.map((o) => o.subject).sort()).toEqual([JAKE, SAM].sort());
    // Independently completable.
    expect(new Set(projected.map((o) => o.occurrenceKey)).size).toBe(2);
  });

  it('keeps the someday chore off the agenda entirely', async () => {
    const chores = (await loadChores()).filter((c) => c.title === 'Clear out the garage');
    expect(chores).toHaveLength(1);
    expect(chores[0]?.schedule.rule.kind).toBe('unscheduled');

    const projected = projectOccurrences(
      {
        chores,
        completions: [],
        exceptions: [],
        memberIds: [JAKE, SAM],
        today: civilDate('2026-01-07'),
      },
      CAL,
      { start: civilDate('2026-01-04'), end: civilDate('2026-02-01') },
    );
    expect(projected).toEqual([]);
  });

  it('clamps the seeded fridge chore into February', async () => {
    const chores = (await loadChores()).filter((c) => c.title === 'Deep clean the fridge');
    const projected = projectOccurrences(
      {
        chores,
        completions: [],
        exceptions: [],
        memberIds: [JAKE, SAM],
        today: civilDate('2026-02-01'),
      },
      CAL,
      { start: civilDate('2026-02-01'), end: civilDate('2026-02-28') },
    );

    // The bug that killed the previous version, now proven against a real row.
    expect(projected.map((o) => o.dueOn)).toEqual(['2026-02-28']);
  });
});

describe('a completion written to the database reaches the projector', () => {
  it('flips an occurrence to completed by occurrence key', async () => {
    const admin = adminClient();
    const chores = (await loadChores()).filter((c) => c.title === 'Dishes');
    const window = { start: civilDate('2026-03-02'), end: civilDate('2026-03-08') };

    const before = projectOccurrences(
      {
        chores,
        completions: [],
        exceptions: [],
        memberIds: [JAKE, SAM],
        today: civilDate('2026-03-04'),
      },
      CAL,
      window,
    );
    const target = before[0];
    expect(target).toBeDefined();
    const key = target?.occurrenceKey as string;

    await admin.from('chore_completions').delete().eq('occurrence_key', key);
    const insert = await admin.from('chore_completions').insert({
      household_id: HOUSEHOLD,
      chore_id: chores[0]?.id as string,
      occurrence_key: key,
      due_on: target?.dueOn as string,
      completed_on: '2026-03-03',
      completed_by: SAM,
    });
    expect(insert.error).toBeNull();

    // Read it back the way the app will, then project.
    const { data } = await admin
      .from('chore_completions')
      .select('chore_id, occurrence_key, completed_on, completed_by')
      .eq('occurrence_key', key);

    const after = projectOccurrences(
      {
        chores,
        completions: (data ?? []).map((row) => ({
          choreId: row.chore_id,
          occurrenceKey: row.occurrence_key,
          completedOn: civilDate(row.completed_on),
          completedBy: row.completed_by,
        })),
        exceptions: [],
        memberIds: [JAKE, SAM],
        today: civilDate('2026-03-04'),
      },
      CAL,
      window,
    );

    const done = after.find((o) => o.occurrenceKey === key);
    expect(done?.status).toBe('completed');
    expect(done?.completedBy).toBe(SAM);

    await admin.from('chore_completions').delete().eq('occurrence_key', key);
  });
});
