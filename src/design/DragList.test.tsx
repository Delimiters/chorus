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
import { Animated, PanResponder, StyleSheet, Text } from 'react-native';
import type { PanResponderCallbacks } from 'react-native';

import { DragList } from './DragList';

const ITEMS = [
  { key: 'a', title: 'Dishes' },
  { key: 'b', title: 'Trash' },
  { key: 'c', title: 'Litter' },
];

const onReorder = jest.fn();

/*
 * A component rather than an inline element, so a re-render can be driven with
 * the same tree — which is what the interrupted-tap test needs.
 */
const onDragStateChange = jest.fn();

const Harness = ({ items = ITEMS }: { items?: typeof ITEMS }) => (
  <DragList
    items={items}
    keyOf={(i) => i.key}
    labelOf={(i) => i.title}
    renderItem={(i) => <Text>{i.title}</Text>}
    onReorder={onReorder}
    onDragStateChange={onDragStateChange}
  />
);

function renderList() {
  return render(<Harness />);
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
const touch = (
  key: string,
  event: 'onTouchStart' | 'onTouchMove' | 'onTouchEnd' | 'onTouchCancel',
  // A finger has to be somewhere: `onTouchStart` records where, so a later move
  // can be told apart from a hold.
  at: { pageX: number; pageY: number } = { pageX: 100, pageY: 400 },
) => {
  act(() => {
    screen.getByTestId(`drag-row:${key}`).props[event]({ nativeEvent: at });
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
  onDragStateChange.mockClear();
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

  it('does not pick a row up after a tap that was interrupted by a re-render', () => {
    /*
     * The version of this that a review caught as vacuous. The hold timer used
     * to be a `let` inside the render's `.map()`, so it belonged to *that*
     * render: any re-render between finger-down and finger-up handed
     * `onTouchEnd` a fresh closure whose timer was `null`, and the real one was
     * never cleared. The row was then picked up 220ms after the finger had
     * gone, with no gesture left to put it down — and `scrollEnabled={!dragging}`
     * meant the plan could not be scrolled at all until you tapped it again.
     *
     * This screen re-renders on any of several query hooks, so the interruption
     * is ordinary rather than exotic. Without one, this test passes against the
     * bug.
     */
    const { rerender } = renderList();

    touch('b', 'onTouchStart');
    act(() => {
      rerender(<Harness />);
    });
    touch('b', 'onTouchEnd');

    act(() => {
      jest.advanceTimersByTime(300);
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

describe('a whole drag, driven through the responder', () => {
  /*
   * `fireEvent` cannot produce a pan, so the responder config is captured as
   * the component builds it and its handlers are called directly with the
   * gesture state React Native would have supplied. It is the only way to reach
   * the two fixes a review pointed out had no test at all — the gap that opens
   * under the held row, and what happens on release.
   */
  const configs: PanResponderCallbacks[] = [];
  let timings: { toValue: number }[] = [];

  const setHeights = (height: number) => {
    for (const item of ITEMS) {
      act(() => {
        screen
          .getByTestId(`drag-row:${item.key}`)
          .props.onLayout({ nativeEvent: { layout: { height } } });
      });
    }
  };

  /** The handlers for a row, from the most recent render. */
  const configFor = (index: number) => configs.slice(-ITEMS.length)[index] as PanResponderCallbacks;

  beforeEach(() => {
    configs.length = 0;
    timings = [];
    jest.spyOn(PanResponder, 'create').mockImplementation((config) => {
      configs.push(config);
      return { panHandlers: {} } as ReturnType<typeof PanResponder.create>;
    });
    jest.spyOn(Animated, 'timing').mockImplementation((_value, config) => {
      timings.push({ toValue: config.toValue as number });
      return {
        start: (done?: (result: { finished: boolean }) => void) => done?.({ finished: true }),
        stop: () => {},
        reset: () => {},
      } as unknown as Animated.CompositeAnimation;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not let one interrupted gap stop the others', () => {
    /*
     * `Animated.parallel` stops every member when one is interrupted, and
     * re-animating a value interrupts it. With the guard that skips rows whose
     * target has not changed — which is exactly the set that got stopped — a
     * wobble across two slots and back inside the 140ms animation left a row
     * frozen mid-shift, overlapping its neighbour, for the rest of the drag.
     *
     * Asserted on the wiring, because the stub below makes every animation
     * finish instantly and so cannot reproduce the interruption. The behaviour
     * itself was reproduced with real timers before this was written.
     */
    const parallel = jest.spyOn(Animated, 'parallel');
    renderList();
    setHeights(60);
    pickUp('a');

    act(() => {
      configFor(0).onPanResponderMove?.({} as never, { dy: 90 } as never);
    });

    expect(parallel).toHaveBeenLastCalledWith(expect.anything(), { stopTogether: false });
  });

  it('opens a gap under the row it is being dragged over', () => {
    renderList();
    setHeights(60);
    pickUp('a');
    timings = [];

    // 60-tall rows: dragging row 0 down by 90 puts its centre past row 1's
    // midpoint but not row 2's, so it lands at index 1.
    act(() => {
      configFor(0).onPanResponderMove?.({} as never, { dy: 90 } as never);
    });

    /*
     * One animation, not three: rows already sitting where they belong are not
     * re-animated, which is what keeps this screen's constant re-renders from
     * restarting animations under the finger. So `c` not appearing here *is*
     * the assertion that `c` does not move — the drag never reached it.
     */
    expect(timings.map((t) => t.toValue)).toEqual([-60]);
  });

  it('reports the new order on release, and puts the row down', () => {
    renderList();
    setHeights(60);
    pickUp('a');

    act(() => {
      configFor(0).onPanResponderMove?.({} as never, { dy: 90 } as never);
      configFor(0).onPanResponderRelease?.({} as never, { dy: 90 } as never);
    });

    expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c'], 'a');
    expect(styleOf('a').zIndex).toBe(0);
  });

  it('will not let a row be dragged off the end of the list', () => {
    /*
     * Asserted on where the row is *drawn*, not on where it lands — the landing
     * index is the same either way, which is what made the first version of
     * this test pass with the clamp removed.
     *
     * Unclamped the row followed the finger out into the page, so a wild drag
     * left it hundreds of points outside the list and it teleported the whole
     * way back on release. Three 60pt rows: the top one can travel exactly 120.
     */
    renderList();
    setHeights(60);
    pickUp('a');

    act(() => {
      configFor(0).onPanResponderMove?.({} as never, { dy: 5000 } as never);
    });

    const held = StyleSheet.flatten(screen.getByTestId('drag-row:a').props.style) as {
      transform: { translateY: number }[];
    };
    expect(held.transform[0]?.translateY).toBe(120);
  });

  it('still reports the last slot for a drag past the end', () => {
    renderList();
    setHeights(60);
    pickUp('a');

    act(() => {
      configFor(0).onPanResponderRelease?.({} as never, { dy: 5000 } as never);
    });

    expect(onReorder).toHaveBeenCalledWith(['b', 'c', 'a'], 'a');
  });
});

describe('a drag that cannot be finished by the finger that started it', () => {
  it('ends when the held row leaves the list', () => {
    /*
     * The row's responder and its `onTouchEnd` go with it, so nothing was left
     * that could put it down. `dragging` stayed set forever and the plan's
     * `scrollEnabled={!dragging}` meant the screen could not be scrolled again
     * until another row was picked up and dropped. Reachable whenever the other
     * phone takes something off the day mid-drag.
     */
    const { rerender } = renderList();
    pickUp('b');
    expect(onDragStateChange).toHaveBeenLastCalledWith(true);

    act(() => {
      rerender(<Harness items={ITEMS.filter((i) => i.key !== 'b')} />);
    });

    expect(onDragStateChange).toHaveBeenLastCalledWith(false);
  });

  it('hands the scroll view back when it unmounts mid-drag', () => {
    const { unmount } = renderList();
    pickUp('b');

    act(() => {
      unmount();
    });

    expect(onDragStateChange).toHaveBeenLastCalledWith(false);
  });
});

describe('scrolling past a row rather than picking it up', () => {
  /*
   * Reported from the phone: "the scrolling kinda sucks on that page, it like
   * gets stuck when you scroll randomly." Two halves, both here.
   */
  it('does not pick a row up when the finger is travelling', () => {
    /*
     * Press, then scroll. The hold used to fire 220ms in regardless, and
     * `scrollEnabled={!dragging}` then stopped the scroll dead mid-flick.
     */
    renderList();

    touch('b', 'onTouchStart', { pageX: 100, pageY: 400 });
    touch('b', 'onTouchMove', { pageX: 100, pageY: 360 });
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(styleOf('b').zIndex).toBe(0);
    expect(onDragStateChange).not.toHaveBeenCalledWith(true);
  });

  it('still picks up a finger that stays put', () => {
    // The slop has to be small enough that a deliberate press survives the
    // wobble of a thumb, or the feature is simply gone.
    renderList();

    touch('b', 'onTouchStart', { pageX: 100, pageY: 400 });
    touch('b', 'onTouchMove', { pageX: 101, pageY: 402 });
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(styleOf('b').zIndex).toBe(2);
  });

  it('puts the row down when the scroll view takes the gesture', () => {
    /*
     * The half that made it stick rather than stutter. A scroll view claiming
     * the responder sends a *cancel*, not an end — and only `onTouchEnd` put
     * the row down, so `scrollEnabled` stayed false and the plan could not be
     * scrolled again at all.
     */
    renderList();
    pickUp('b');
    expect(styleOf('b').zIndex).toBe(2);

    touch('b', 'onTouchCancel');

    expect(styleOf('b').zIndex).toBe(0);
    expect(onDragStateChange).toHaveBeenLastCalledWith(false);
  });
});
