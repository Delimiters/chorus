/**
 * Turning a civil date and time into the instant a notification fires.
 *
 * The one place in the app allowed to build a `Date` from a due date, and
 * therefore the one place the whole civil-date discipline can be undone by a
 * one-character mistake. `new Date('2026-07-30')` parses as UTC midnight and
 * `new Date(2026, 6, 30)` as local midnight; picking the wrong one moves every
 * reminder by up to a day, in one direction for half the world.
 */

import * as Notifications from 'expo-notifications';

import { fireAt, localTransport } from './notifications';

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

describe('what reaches the operating system', () => {
  /*
   * The line that makes a nagging chore audible had no test at all: a review
   * stripped both `sound` and `interruptionLevel` from the content and all 293
   * tests in `src/data` and `src/core/notify` stayed green. Every other test in
   * that change stopped at `insistent: true` on the planner's output, which is
   * the half that was already covered.
   */
  const scheduled: { id: string; content: Record<string, unknown> }[] = [];

  beforeEach(() => {
    scheduled.length = 0;
    jest.spyOn(Notifications, 'cancelAllScheduledNotificationsAsync').mockResolvedValue();
    jest.spyOn(Notifications, 'scheduleNotificationAsync').mockImplementation(async (request) => {
      const r = request as unknown as { identifier: string; content: Record<string, unknown> };
      scheduled.push({ id: r.identifier, content: r.content });
      return r.identifier;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  const reminder = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    choreId: 'dishes',
    title: 'Dishes',
    body: 'due today',
    // Far enough ahead that the "already past" guard does not drop it.
    onDate: '2099-01-01',
    atTime: '09:00',
    ...over,
  });

  it('asks for sound and Time Sensitive on a nagging reminder', async () => {
    await localTransport.reconcile([reminder({ insistent: true })] as never);

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.content.sound).toBe('default');
    expect(scheduled[0]?.content.interruptionLevel).toBe('timeSensitive');
  });

  it('leaves an ordinary reminder silent and ordinary', async () => {
    /*
     * The other half, and the one that matters more: a chore app that pings all
     * day is a chore app with notifications switched off. `critical` is absent
     * too — it overrides the silent switch and needs Apple's approval, granted
     * to medical and safety apps.
     */
    await localTransport.reconcile([reminder()] as never);

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.content.sound).toBeUndefined();
    expect(scheduled[0]?.content.interruptionLevel).toBeUndefined();
  });

  it('carries the chore id either way, so a tap can open the right thing', async () => {
    await localTransport.reconcile([
      reminder({ id: 'a' }),
      reminder({ id: 'b', insistent: true }),
    ] as never);

    expect(scheduled.map((s) => (s.content.data as { choreId: string }).choreId)).toEqual([
      'dishes',
      'dishes',
    ]);
  });
});
