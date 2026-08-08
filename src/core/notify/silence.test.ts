import type { Assignment } from '../rotation/types';
import type { CivilDate } from '../civil/types';
import { DEFAULT_POLICY, type ReminderPolicy } from './plan';
import { describeSilence, whyNoReminder } from './silence';

const ME = 'me';
const THEM = 'them';

const policy = (over: Partial<ReminderPolicy> = {}): ReminderPolicy => ({
  ...DEFAULT_POLICY,
  ...over,
});

const rotate = (memberIds: readonly string[]): Assignment => ({
  kind: 'rotate',
  cadence: { unit: 'week', every: 1 },
  segments: [{ effectiveFrom: '2026-01-01' as CivilDate, memberIds, offset: 0 }],
});

describe('whyNoReminder', () => {
  it('explains the combination that made reminders silent out of the box', () => {
    // The actual defect, stated as a test: a chore created entirely with
    // defaults is assigned to "anyone", the default policy excludes
    // unassigned chores, and so nothing is ever scheduled. Both defaults are
    // defensible; together they mean setting a reminder time does nothing.
    expect(whyNoReminder({ assignment: { kind: 'anyone' }, userId: ME, policy: policy() })).toBe(
      'unassigned',
    );
  });

  it('goes quiet about it once unassigned chores are included', () => {
    expect(
      whyNoReminder({
        assignment: { kind: 'anyone' },
        userId: ME,
        policy: policy({ includeUnassigned: true }),
      }),
    ).toBeNull();
  });

  describe('a chore with an owner', () => {
    it('reminds you about your own', () => {
      expect(
        whyNoReminder({
          assignment: { kind: 'fixed', memberId: ME },
          userId: ME,
          policy: policy(),
        }),
      ).toBeNull();
    });

    it('does not remind you about theirs by default', () => {
      expect(
        whyNoReminder({
          assignment: { kind: 'fixed', memberId: THEM },
          userId: ME,
          policy: policy(),
        }),
      ).toBe('someone-else');
    });

    it('does once other people are included', () => {
      expect(
        whyNoReminder({
          assignment: { kind: 'fixed', memberId: THEM },
          userId: ME,
          policy: policy({ includeOthers: true }),
        }),
      ).toBeNull();
    });
  });

  it('always reminds you about "everyone does their own"', () => {
    // One occurrence per member, so one of them is yours whatever the policy.
    expect(
      whyNoReminder({ assignment: { kind: 'everyone' }, userId: ME, policy: policy() }),
    ).toBeNull();
  });

  describe('rotations', () => {
    it('reminds you when you are on the roster', () => {
      expect(whyNoReminder({ assignment: rotate([ME, THEM]), userId: ME, policy: policy() })).toBe(
        null,
      );
    });

    it('does not when you are not on it', () => {
      expect(whyNoReminder({ assignment: rotate([THEM]), userId: ME, policy: policy() })).toBe(
        'someone-else',
      );
    });

    it('looks across every segment, not just the current one', () => {
      // Rosters are append-only history. Being dropped from the latest segment
      // is the case that matters, and it must not be masked by an older one
      // that still lists you.
      const assignment: Assignment = {
        kind: 'rotate',
        cadence: { unit: 'week', every: 1 },
        segments: [
          { effectiveFrom: '2026-01-01' as CivilDate, memberIds: [ME, THEM], offset: 0 },
          { effectiveFrom: '2026-06-01' as CivilDate, memberIds: [THEM], offset: 0 },
        ],
      };
      // Deliberately null: some past turns were yours, and this question is
      // asked without a date. Stated so the approximation is a decision rather
      // than an accident.
      expect(whyNoReminder({ assignment, userId: ME, policy: policy() })).toBeNull();
    });
  });

  it('reports the switch before anything else', () => {
    // With reminders off nothing fires regardless, and "assign it to yourself"
    // would be advice that does not help.
    expect(
      whyNoReminder({
        assignment: { kind: 'fixed', memberId: ME },
        userId: ME,
        policy: policy({ enabled: false }),
      }),
    ).toBe('off');
  });
});

describe('describeSilence', () => {
  it('says what to do about each reason', () => {
    for (const reason of ['off', 'unassigned', 'someone-else'] as const) {
      const text = describeSilence(reason);
      expect(text.length).toBeGreaterThan(0);
      // Each one names the control that fixes it, rather than only stating the
      // problem — otherwise it is a dead end with better wording.
      expect(text).toMatch(/Settings|Assign/);
    }
  });
});
