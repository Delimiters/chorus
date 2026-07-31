/**
 * Turning a civil date and time into the instant a notification fires.
 *
 * The one place in the app allowed to build a `Date` from a due date, and
 * therefore the one place the whole civil-date discipline can be undone by a
 * one-character mistake. `new Date('2026-07-30')` parses as UTC midnight and
 * `new Date(2026, 6, 30)` as local midnight; picking the wrong one moves every
 * reminder by up to a day, in one direction for half the world.
 */

import { fireAt } from './notifications';

describe('fireAt', () => {
  it('builds the instant in the device’s own zone', () => {
    const when = fireAt('2026-07-30', '09:00');
    // Read back with local getters: whatever zone the runner is in, nine in the
    // morning has to be nine in the morning.
    expect(when.getFullYear()).toBe(2026);
    expect(when.getMonth()).toBe(6); // July, zero-based
    expect(when.getDate()).toBe(30);
    expect(when.getHours()).toBe(9);
    expect(when.getMinutes()).toBe(0);
  });

  it('does not drift a day, whatever the runner’s offset', () => {
    // The failure this guards: string parsing would make this UTC midnight,
    // which is the previous evening anywhere west of Greenwich.
    const when = fireAt('2026-01-01', '00:30');
    expect(when.getDate()).toBe(1);
    expect(when.getMonth()).toBe(0);
    expect(when.getHours()).toBe(0);
  });

  it('handles an evening time', () => {
    const when = fireAt('2026-12-25', '19:45');
    expect(when.getHours()).toBe(19);
    expect(when.getMinutes()).toBe(45);
  });

  it('lands on the right day at the end of a month', () => {
    const when = fireAt('2026-02-28', '23:59');
    expect(when.getMonth()).toBe(1);
    expect(when.getDate()).toBe(28);
  });

  it('carries no seconds, so reminders do not fire at odd-looking times', () => {
    const when = fireAt('2026-07-30', '09:00');
    expect(when.getSeconds()).toBe(0);
    expect(when.getMilliseconds()).toBe(0);
  });
});
