import { assertNever } from './assertNever';

describe('assertNever', () => {
  it('throws with the offending value', () => {
    expect(() => assertNever('surprise' as never)).toThrow(/Unhandled value: "surprise"/);
  });

  it('includes the supplied context', () => {
    expect(() => assertNever({ kind: 'yearly' } as never, 'recurrence rule')).toThrow(
      /Unhandled recurrence rule: {"kind":"yearly"}/,
    );
  });
});
