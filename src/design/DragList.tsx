/**
 * Press and hold to drag a row into a new place, with rows of any height.
 *
 * A sibling of `features/house/ReorderableList`, not a replacement: that one
 * assumes a fixed row height so the drag offset divided by the height *is* the
 * number of places moved — exact, cheap, and only true for uniform rows. Plan
 * rows are deliberately not uniform, because a chore whose name needs two lines
 * gets two lines.
 *
 * So rows are measured with `onLayout` and the arithmetic lives in
 * `core/plan/reorder.ts`, where it can be tested without a gesture. A drag that
 * lands one place off looks like a slippery finger rather than a defect, which
 * is exactly the kind of wrong that survives.
 *
 * ── What the first version got wrong, on the phone ────────────────────────
 *
 * All of it was invisible to the tests, which drive the accessibility actions
 * rather than a gesture. Jake's report was "the rows go behind the one you're
 * dragging and it's jumpy when you drop it", and that was three separate bugs:
 *
 *   **The lift did nothing.** `zIndex` sat on the inner `Animated.View`, which
 *   is an only child — `zIndex` orders *siblings*, and the siblings are the row
 *   wrappers. So every row below the dragged one painted over it. It now sits
 *   on the wrapper, which is the element that actually has siblings.
 *
 *   **Nothing moved out of the way.** The list stood still while you held a row
 *   over it and rearranged only on release, which reads as the list jumping
 *   rather than as you having put something somewhere. Rows now open a gap as
 *   the target changes.
 *
 *   **The drop snapped.** Not this component's fault, as it turned out, and a
 *   first attempt to fix it here — holding a locally reordered copy until the
 *   props caught up — was worse: it could not tell "the write landed" from "an
 *   unrelated refetch", so any completion toggle during the round trip snapped
 *   the list back and it jumped *twice*. The cause was `useReorderPlan`
 *   awaiting `cancelQueries` before writing the optimistic order, which pushed
 *   the reorder a frame past the finger lifting. Fixed there, so this component
 *   simply renders what it is given.
 *
 * **Dragging is not the only way to reorder.** Every row carries accessibility
 * actions for moving up and down, because a drag is unusable with VoiceOver and
 * "there's a handle" is not an accessible reorder story. That rule comes from
 * the list this is modelled on.
 *
 * Built on `PanResponder` and `Animated` rather than a gesture library: the
 * project is on Reanimated 4, the community draggable lists want 2 or 3, and
 * `GestureHandlerRootView` is not wired. See the note in ReorderableList.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, View } from 'react-native';

import { clampToList, reorder, shiftFor, targetIndex } from '@/core/plan/reorder';

/** How long to hold before a press becomes a drag rather than a tap. */
const HOLD_MS = 220;

/** Long enough to read as movement, short enough not to lag the finger. */
const SHIFT_MS = 140;

/**
 * How far a finger may travel and still be holding rather than scrolling.
 *
 * Points of combined x+y movement. Small enough that a deliberate press is not
 * cancelled by the wobble of a thumb, large enough that the start of a flick
 * is.
 */
const SCROLL_SLOP = 8;

interface Props<T> {
  items: readonly T[];
  keyOf: (item: T) => string;
  labelOf: (item: T) => string;
  renderItem: (item: T, dragging: boolean) => React.ReactNode;
  /**
   * Called once, on release, with the new order and **which row moved**.
   *
   * The moved key is passed rather than left to be inferred, because inferring
   * it from the two orders is wrong in one direction: moving `a` from the top
   * of `[a, b, c]` to the bottom gives `[b, c, a]`, whose first differing index
   * is 0 — `b`, which did not move.
   */
  onReorder: (orderedKeys: readonly string[], movedKey: string) => void;
  /** So the surrounding scroll view can be frozen while a drag is live. */
  onDragStateChange?: (dragging: boolean) => void;
}

export function DragList<T>({
  items,
  keyOf,
  labelOf,
  renderItem,
  onReorder,
  onDragStateChange,
}: Props<T>) {
  const [dragging, setDraggingState] = useState<string | null>(null);
  /**
   * The same value, for the kept responder to read.
   *
   * Not because the handler is captured at touch time — it is not; React
   * resolves it from the view's current props at every event. It is because
   * the responder itself is now created once and reused, so its closure never
   * sees a later render's `dragging`.
   */
  const draggingRef = useRef<string | null>(null);

  /*
   * Props the responder needs, in refs.
   *
   * The responder below is built once per row and then kept, so its closure is
   * the *first* render's. Anything it reads from props has to come through a
   * ref or it is frozen at mount — `onReorder` in particular is an inline
   * arrow on the plan that closes over the day's rows and their owner.
   */
  const keyOfRef = useRef(keyOf);
  keyOfRef.current = keyOf;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  /** Writes both, so the ref can never drift from the state it mirrors. */
  const setDragging = (key: string | null) => {
    draggingRef.current = key;
    setDraggingState(key);
  };
  /** Where the held row would land right now. Drives the gap, not the drop. */
  const [target, setTarget] = useState<number | null>(null);

  /**
   * One `PanResponder` per row, kept for the life of the list.
   *
   * It used to be built inside the render loop, and that is what stopped rows
   * being dragged. `PanResponder.create` allocates its own `gestureState`, and
   * `dy` is accumulated *in that object* — so a fresh one starts again at
   * zero. The responder system resolves the handler from the view's current
   * props at every touch, so the moment React committed a new render the
   * moves were routed to a new responder that thought the finger had not
   * moved.
   *
   * And this drag re-renders itself: `onPanResponderMove` calls `setTarget` as
   * soon as the row crosses a neighbour's midpoint. So the row tracked the
   * finger for about half a row, snapped back to nothing, and on release
   * reported a `dy` too small to have changed its index — lifted, barely
   * moving, and impossible to reorder. Measured frame by frame: 10, 10, 20,
   * 30, 40, 50, 60, **10**, 10, 20, and `onReorder` never called.
   *
   * `ReorderableList` — the sibling that has always worked on a phone — holds
   * its responder in a ref for exactly this reason. This one had diverged.
   */
  const responders = useRef<Map<string, ReturnType<typeof PanResponder.create>>>(new Map());

  const offset = useRef(new Animated.Value(0)).current;

  /*
   * Measured heights, the live order, and the live target, in refs.
   *
   * The PanResponder is created once per render and closes over whatever it
   * captured, so anything it reads mid-drag has to be a ref — reading state
   * there is the stale-closure bug this codebase has hit more than once.
   */
  const heights = useRef<Map<string, number>>(new Map());

  /*
   * Hold timers keyed by row, not a local inside the render.
   *
   * `let holdTimer` in the map callback belongs to *that render*. Any re-render
   * between finger-down and finger-up — and this screen re-renders on any of
   * several query hooks — gave `onTouchEnd` a fresh closure whose timer was
   * null, so the timer was never cleared: the row was picked up 220ms after the
   * finger had gone, and stayed picked up. `scrollEnabled={!dragging}` meant
   * the plan then could not be scrolled at all.
   */
  const holdTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  /*
   * Where each touch began, keyed by row — not one shared origin.
   *
   * With a single ref, two fingers on two rows shared it: the second touch
   * overwrote it, the first measured its travel against the wrong point, and
   * cancelling either one nulled it for both. After that the slop guard simply
   * stopped running, and the next flick re-froze the page — the very bug this
   * guard exists to prevent, restored by a second finger.
   */
  const touchOrigins = useRef<Map<string, { x: number; y: number }>>(new Map());

  const cancelHold = (key: string) => {
    const pending = holdTimers.current.get(key);
    if (pending !== undefined) {
      clearTimeout(pending);
      holdTimers.current.delete(key);
    }
    touchOrigins.current.delete(key);
  };
  const order = useRef<readonly T[]>(items);
  order.current = items;
  const targetRef = useRef<number | null>(null);

  /** One animated offset per row, so a shift does not re-render the list. */
  const gaps = useRef<Map<string, Animated.Value>>(new Map());
  const gapFor = (key: string) => {
    const held = gaps.current.get(key);
    if (held !== undefined) return held;
    const created = new Animated.Value(0);
    gaps.current.set(key, created);
    return created;
  };

  /** The gap each row has already been sent to, so it is not re-animated. */
  const applied = useRef<Map<string, number>>(new Map());

  /*
   * Values for rows that have gone are dropped, after being put back to zero.
   *
   * A row that was displaced and then left the list kept its offset, so if the
   * key ever came back it rendered a row-height out of place, on top of its
   * neighbour. The map would also have grown for the lifetime of the screen.
   */
  useEffect(() => {
    const live = new Set(items.map(keyOf));
    for (const [key, value] of gaps.current) {
      if (live.has(key)) continue;
      value.setValue(0);
      gaps.current.delete(key);
      applied.current.delete(key);
    }
  }, [items, keyOf]);

  useEffect(() => {
    onDragStateChange?.(dragging !== null);
  }, [dragging, onDragStateChange]);

  /*
   * A row that disappears while it is being held ends the drag.
   *
   * Its responder and its `onTouchEnd` go with it, so nothing was left that
   * could put it down: `dragging` stayed set forever and the surrounding
   * `scrollEnabled={!dragging}` meant the plan could not be scrolled again
   * until another row was picked up and dropped. Reachable whenever the other
   * phone removes something from the day mid-drag.
   */
  useEffect(() => {
    if (dragging === null) return;
    if (items.some((item) => keyOf(item) === dragging)) return;
    stopDragging();
    // `stopDragging` is stable in effect: it only touches refs and setState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, dragging, keyOf]);

  /*
   * Unmounting mid-drag otherwise left `onDragStateChange` last told `true`,
   * so the surrounding `scrollEnabled={!dragging}` stayed off, and a pending
   * hold timer fired into a component that no longer exists.
   */
  const dragStateChanged = useRef(onDragStateChange);
  dragStateChanged.current = onDragStateChange;
  useEffect(
    () => () => {
      for (const timer of holdTimers.current.values()) clearTimeout(timer);
      holdTimers.current.clear();
      dragStateChanged.current?.(false);
    },
    [],
  );

  /*
   * Animate every row to where the current target says it should sit.
   *
   * `items` is a dependency, and has to be. The target is an *index*, so it
   * only means anything against the array it was computed from — with `items`
   * left out, a realtime reorder arriving from the other phone while a finger
   * was held still left the gap open under the wrong row until the next move.
   * Holding still is exactly what people do while aiming.
   *
   * `applied` is what stops that costing anything: a row whose gap is already
   * where it should be is not re-animated, so the re-renders this screen does
   * constantly do not restart animations under the finger.
   */
  useEffect(() => {
    const from = dragging === null ? -1 : items.findIndex((item) => keyOf(item) === dragging);
    const height = dragging === null ? 0 : (heights.current.get(dragging) ?? 0);

    const animations = items.flatMap((item, index) => {
      const key = keyOf(item);
      const to = from === -1 || target === null ? 0 : shiftFor(from, target, index, height);
      if (applied.current.get(key) === to) return [];
      applied.current.set(key, to);
      return [
        Animated.timing(gapFor(key), {
          toValue: to,
          duration: SHIFT_MS,
          useNativeDriver: true,
        }),
      ];
    });

    /*
     * `stopTogether: false`, and it is load-bearing.
     *
     * `Animated.parallel` defaults to stopping every member the moment one of
     * them is interrupted — and re-animating a value interrupts it. Combined
     * with the `applied` guard, which deliberately does *not* re-issue rows
     * whose target has not changed, that froze those rows partway: an ordinary
     * wobble across two slots and back within the animation's 140ms left a row
     * stopped mid-shift, overlapping its neighbour, for the rest of the drag.
     */
    if (animations.length > 0) Animated.parallel(animations, { stopTogether: false }).start();
  }, [dragging, target, items, keyOf]);

  const stopDragging = () => {
    offset.setValue(0);
    targetRef.current = null;
    setTarget(null);
    setDragging(null);
  };
  /* Stable identity for the kept responder; the body only touches refs and
     state setters, both of which are stable themselves. */
  const stopDraggingRef = useRef(stopDragging);
  stopDraggingRef.current = stopDragging;

  /** The responder for a row, created on first sight and then kept. */
  const responderFor = (key: string): ReturnType<typeof PanResponder.create> => {
    const existing = responders.current.get(key);
    if (existing !== undefined) return existing;

    const created = PanResponder.create({
      // The hold is what separates a drag from a tap, so the responder is
      // only claimed once the timer below has fired.
      onStartShouldSetPanResponder: () => false,
      /*
       * A ref, because this config is built once and then kept — see the note
       * on `responders` above. Reading `dragging` here would freeze it at the
       * value it had when the row first rendered, which is `null` forever.
       *
       * No capture-phase twin. One was added on the theory that the row's
       * `Pressable` owns the gesture by the time the finger moves and would
       * refuse to give it up; that is backwards. When the current responder is
       * a descendant, React dispatches from the common ancestor *upward* and
       * skips the responder's own subtree, so this view is the one being
       * asked. `ReorderableList` has always shipped with only this handler.
       */
      onMoveShouldSetPanResponder: () => draggingRef.current === key,

      /*
       * Once it is a drag, no other React view can take it — the only
       * candidates are sibling rows, whose predicate is false anyway.
       *
       * It does *not* stop the scroll view: a native reclaim arrives as a
       * touch cancel, which terminates unconditionally without consulting
       * this. Kept because `ReorderableList` does the same.
       */
      onPanResponderTerminationRequest: () => false,

      onPanResponderMove: (_event, gesture) => {
        const current = order.current;
        const from = current.findIndex((i) => keyOfRef.current(i) === key);
        const measured = current.map((i) => heights.current.get(keyOfRef.current(i)) ?? 0);

        /*
         * Held inside the list.
         *
         * Unclamped, a row dragged well past either end followed the finger
         * out into the page and then teleported all the way back on
         * release — the further you overshot, the bigger the jump. Now it
         * stops at the ends, which is also the honest signal that there is
         * nowhere further to go.
         */
        const dy = clampToList(measured, from, gesture.dy);

        offset.setValue(dy);
        const to = targetIndex(measured, from, dy);

        // Only when it changes: a setState per pixel would re-render the
        // whole list on every frame of the gesture.
        if (to !== targetRef.current) {
          targetRef.current = to;
          setTarget(to);
        }
      },

      onPanResponderRelease: (_event, gesture) => {
        const current = order.current;
        const from = current.findIndex((i) => keyOfRef.current(i) === key);
        const measured = current.map((i) => heights.current.get(keyOfRef.current(i)) ?? 0);
        const to = targetIndex(measured, from, clampToList(measured, from, gesture.dy));

        if (to !== from) {
          /*
           * Order out first, then everything resets in the same tick.
           *
           * The optimistic write in `useReorderPlan` now lands before the
           * next paint, so by the time these offsets are zero the rows are
           * already in their new places. Holding a local copy to bridge the
           * gap was tried and was worse — see the note at the top.
           */
          onReorderRef.current(reorder(current, from, to).map(keyOf), key);
          for (const value of gaps.current.values()) value.setValue(0);
          applied.current.clear();
        }

        stopDraggingRef.current();
      },

      onPanResponderTerminate: () => stopDraggingRef.current(),
    });

    responders.current.set(key, created);
    return created;
  };

  const move = (key: string, delta: number) => {
    const current = order.current;
    const from = current.findIndex((item) => keyOf(item) === key);
    if (from === -1) return;
    const to = Math.max(0, Math.min(current.length - 1, from + delta));
    if (to === from) return;
    onReorder(reorder(current, from, to).map(keyOf), key);
  };

  return (
    <View>
      {items.map((item) => {
        const key = keyOf(item);
        const isDragging = dragging === key;

        const responder = responderFor(key);

        return (
          <Animated.View
            key={key}
            testID={`drag-row:${key}`}
            onLayout={(event) => {
              heights.current.set(key, event.nativeEvent.layout.height);
            }}
            onTouchStart={(event) => {
              /*
               * One drag at a time. A second finger landing on another row
               * armed a hold that `onTouchMove` then refused to cancel — it
               * returns early whenever anything is being dragged — so 220ms
               * later that row was picked up too and the row actually in your
               * hand snapped back to its slot mid-gesture.
               */
              if (dragging !== null) return;
              const existing = holdTimers.current.get(key);
              if (existing !== undefined) clearTimeout(existing);
              // Where the finger went down, so a scroll can be told from a hold.
              touchOrigins.current.set(key, {
                x: event.nativeEvent.pageX,
                y: event.nativeEvent.pageY,
              });
              holdTimers.current.set(
                key,
                setTimeout(() => {
                  holdTimers.current.delete(key);
                  setDragging(key);
                }, HOLD_MS),
              );
            }}
            onTouchMove={(event) => {
              /*
               * A finger that has travelled is scrolling, not holding.
               *
               * Without this, pressing and then scrolling picked the row up
               * 220ms in — and `scrollEnabled={!dragging}` then stopped the
               * scroll dead, mid-flick. Jake: "it like gets stuck when you
               * scroll randomly." The hold has to lose the race it was never
               * meant to be in.
               */
              if (dragging !== null) return;
              const origin = touchOrigins.current.get(key);
              if (origin === undefined) return;
              /*
               * Vertical travel only. The list scrolls one way, so sideways
               * movement can never be the start of a scroll — spending the slop
               * budget on it just made a thumb that rolls slightly while
               * pressing fail to pick anything up.
               */
              if (Math.abs(event.nativeEvent.pageY - origin.y) < SCROLL_SLOP) return;
              cancelHold(key);
            }}
            onTouchEnd={() => {
              cancelHold(key);
              // A hold that never became a drag never reaches the responder, so
              // without this the row stays picked up until the next gesture.
              if (dragging === key && targetRef.current === null) stopDragging();
            }}
            /*
             * The scroll view taking the gesture sends a *cancel*, not an end.
             *
             * That was the half that made it stick rather than merely stutter:
             * once the row had been picked up, the only thing that put it down
             * was `onTouchEnd`, which never came — so `scrollEnabled` stayed
             * false and the plan could not be scrolled again at all.
             */
            onTouchCancel={() => {
              cancelHold(key);
              if (dragging === key) stopDragging();
            }}
            accessibilityActions={[
              { name: 'moveUp', label: `Move ${labelOf(item)} up` },
              { name: 'moveDown', label: `Move ${labelOf(item)} down` },
            ]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'moveUp') move(key, -1);
              if (event.nativeEvent.actionName === 'moveDown') move(key, 1);
            }}
            style={{
              /*
               * On the wrapper, not on the child inside it.
               *
               * `zIndex` orders siblings, and the child was an only child — so
               * the lift did nothing and every row below painted over the one
               * in your hand.
               */
              zIndex: isDragging ? 2 : 0,
              elevation: isDragging ? 4 : 0,
              opacity: isDragging ? 0.95 : 1,
              transform: [{ translateY: isDragging ? offset : gapFor(key) }],
            }}
            {...responder.panHandlers}
          >
            {renderItem(item, isDragging)}
          </Animated.View>
        );
      })}
    </View>
  );
}
