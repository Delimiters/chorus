import { parseAssignment, safeParseAssignment } from './schema';

const validSegment = {
  effectiveFrom: '2026-01-04',
  memberIds: ['alice', 'bob'],
  offset: 0,
};

describe('assignment validation', () => {
  it('accepts every well-formed assignment', () => {
    const valid: unknown[] = [
      { kind: 'anyone' },
      { kind: 'everyone' },
      { kind: 'fixed', memberId: 'alice' },
      { kind: 'rotate', cadence: { unit: 'occurrence', every: 1 }, segments: [validSegment] },
      { kind: 'rotate', cadence: { unit: 'week', every: 2 }, segments: [validSegment] },
      { kind: 'rotate', cadence: { unit: 'month', every: 1 }, segments: [validSegment] },
    ];
    for (const assignment of valid) {
      expect(safeParseAssignment(assignment).success).toBe(true);
    }
  });

  it.each([
    ['unknown kind', { kind: 'auction' }],
    ['missing discriminator', { cadence: { unit: 'week', every: 1 } }],
    // The shape that used to reach turnFor and throw, taking down the agenda.
    ['rotate with no cadence', { kind: 'rotate', segments: [validSegment] }],
    [
      'rotate with a bogus cadence unit',
      { kind: 'rotate', cadence: { unit: 'fortnight', every: 1 }, segments: [validSegment] },
    ],
    [
      'rotate with a zero interval',
      { kind: 'rotate', cadence: { unit: 'week', every: 0 }, segments: [validSegment] },
    ],
    [
      'rotate with no segments',
      { kind: 'rotate', cadence: { unit: 'week', every: 1 }, segments: [] },
    ],
    [
      'a segment with an empty roster',
      {
        kind: 'rotate',
        cadence: { unit: 'week', every: 1 },
        segments: [{ ...validSegment, memberIds: [] }],
      },
    ],
    [
      'a segment listing the same person twice',
      {
        kind: 'rotate',
        cadence: { unit: 'week', every: 1 },
        segments: [{ ...validSegment, memberIds: ['alice', 'alice'] }],
      },
    ],
    [
      'a segment with an impossible date',
      {
        kind: 'rotate',
        cadence: { unit: 'week', every: 1 },
        segments: [{ ...validSegment, effectiveFrom: '2026-02-30' }],
      },
    ],
    [
      'a negative offset',
      {
        kind: 'rotate',
        cadence: { unit: 'week', every: 1 },
        segments: [{ ...validSegment, offset: -1 }],
      },
    ],
    ['fixed with no member', { kind: 'fixed' }],
  ])('rejects %s', (_label, assignment) => {
    expect(safeParseAssignment(assignment).success).toBe(false);
  });

  it('rejects segments that are out of chronological order', () => {
    // segmentFor picks the latest applicable segment, so unordered data means
    // something wrote the history wrong.
    const result = safeParseAssignment({
      kind: 'rotate',
      cadence: { unit: 'week', every: 1 },
      segments: [
        { effectiveFrom: '2026-06-01', memberIds: ['alice'], offset: 0 },
        { effectiveFrom: '2026-01-01', memberIds: ['bob'], offset: 0 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('accepts segments in order', () => {
    const result = safeParseAssignment({
      kind: 'rotate',
      cadence: { unit: 'week', every: 1 },
      segments: [
        { effectiveFrom: '2026-01-01', memberIds: ['alice', 'bob'], offset: 0 },
        { effectiveFrom: '2026-06-01', memberIds: ['alice'], offset: 1 },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('parseAssignment', () => {
  it('returns the parsed assignment', () => {
    expect(parseAssignment({ kind: 'anyone' })).toEqual({ kind: 'anyone' });
    expect(
      parseAssignment({
        kind: 'rotate',
        cadence: { unit: 'week', every: 2 },
        segments: [validSegment],
      }),
    ).toMatchObject({ kind: 'rotate', cadence: { unit: 'week', every: 2 } });
  });

  it('throws on invalid input, unlike the safe variant', () => {
    expect(() => parseAssignment({ kind: 'nope' })).toThrow();
  });

  it('accepts a single segment, where there is no previous one to compare against', () => {
    // Exercises the ordering refinement's first-element branch.
    expect(() =>
      parseAssignment({
        kind: 'rotate',
        cadence: { unit: 'occurrence', every: 1 },
        segments: [{ effectiveFrom: '2026-01-04', memberIds: ['alice'], offset: 0 }],
      }),
    ).not.toThrow();
  });

  it('accepts two segments with the same effective date', () => {
    // Ordering is non-strict: equal dates are in order. segmentFor picks the
    // last matching segment, so a same-day append is well defined.
    expect(() =>
      parseAssignment({
        kind: 'rotate',
        cadence: { unit: 'occurrence', every: 1 },
        segments: [
          { effectiveFrom: '2026-01-04', memberIds: ['alice'], offset: 0 },
          { effectiveFrom: '2026-01-04', memberIds: ['bob'], offset: 0 },
        ],
      }),
    ).not.toThrow();
  });
});
