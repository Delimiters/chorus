/**
 * The lift, which shipped broken and which no test could see.
 *
 * `PlanScreen`'s tests drive this list through its accessibility actions, so
 * they exercise the reorder arithmetic and never the gesture. Everything the
 * gesture does visually was therefore unverified, and all of it was wrong on
 * the phone: the held row painted *under* its neighbours, nothing moved aside,
 * and the drop snapped.
 *
 * The hold is a plain `setTimeout`, so the pick-up half is reachable with fake
 * timers even though a pan is not. That is the half that carries the z-order.
 * The gesture itself is checked on device.
 */

import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { DragList } from './DragList';

const ITEMS = [
  { key: 'a', title: 'Dishes' },
  { key: 'b', title: 'Trash' },
  { key: 'c', title: 'Litter' },
];

const onReorder = jest.fn();

function renderList() {
  return render(
    <DragList
      items={ITEMS}
      keyOf={(i) => i.key}
      labelOf={(i) => i.title}
      renderItem={(i) => <Text>{i.title}</Text>}
      onReorder={onReorder}
    />,
  );
}

const styleOf = (key: string) =>
  StyleSheet.flatten(screen.getByTestId(`drag-row:${key}`).props.style) as {
    zIndex?: number;
    opacity?: number;
  };

/*
 * Handlers invoked directly rather than through `fireEvent`.
 *
 * RNTL's synthetic dispatch does not reach `onTouchStart`/`onTouchEnd` here —
 * the props are present on the node and simply are not called — the same thing
 * that stopped `onAccessibilityAction` firing in the plan's tests.
 */
const touch = (key: string, event: 'onTouchStart' | 'onTouchEnd') => {
  act(() => {
    screen.getByTestId(`drag-row:${key}`).props[event]();
  });
};

/** Press and hold, which is what turns a press into a drag. */
const pickUp = (key: string) => {
  touch(key, 'onTouchStart');
  act(() => {
    jest.advanceTimersByTime(300);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  onReorder.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('picking a row up', () => {
  it('lifts it above its neighbours', () => {
    /*
     * The bug Jake reported as "the rows are going behind them". `zIndex`
     * orders *siblings*, and it was set on the row's only child — where it
     * ordered nothing at all, so every row below painted over the one in your
     * hand. It has to sit on the element that has siblings.
     */
    renderList();
    expect(styleOf('b').zIndex).toBe(0);

    pickUp('b');

    expect(styleOf('b').zIndex).toBe(2);
    expect(styleOf('a').zIndex).toBe(0);
    expect(styleOf('c').zIndex).toBe(0);
  });

  it('does not lift anything before the hold completes', () => {
    // Otherwise a tap to tick a chore would flicker as a drag.
    renderList();
    touch('b', 'onTouchStart');
    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(styleOf('b').zIndex).toBe(0);
  });

  it('puts it back down when you let go without moving', () => {
    /*
     * The pan responder is what normally ends a drag, and a hold that never
     * became one never reaches it — so the row stayed picked up, dimmed and
     * floating, until the next gesture.
     */
    renderList();
    pickUp('b');
    expect(styleOf('b').zIndex).toBe(2);

    touch('b', 'onTouchEnd');

    expect(styleOf('b').zIndex).toBe(0);
    expect(styleOf('b').opacity).toBe(1);
  });
});
