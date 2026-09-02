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
 *   **The drop snapped.** The offset reset to zero immediately, but the
 *   reordered rows arrive from the server round trip — `onMutate` is async — so
 *   the row visibly returned to its old slot for a frame or two first. The new
 *   order is now held locally until the real data agrees.
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

import { reorder, shiftFor, targetIndex } from '@/core/plan/reorder';

/** How long to hold before a press becomes a drag rather than a tap. */
const HOLD_MS = 220;

/** Long enough to read as movement, short enough not to lag the finger. */
const SHIFT_MS = 140;

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
  const [dragging, setDragging] = useState<string | null>(null);
  /** Where the held row would land right now. Drives the gap, not the drop. */
  const [target, setTarget] = useState<number | null>(null);

  /*
   * The order to *render*, which is not always the order we were handed.
   *
   * On release the new order is kept here until the props catch up. Without it
   * the row snaps back to where it started and then jumps to where you put it,
   * because the write is a round trip and `onMutate` is async. Cleared the
   * moment `items` changes — whether that is the write landing (same order,
   * invisible) or the write failing and rolling back (the row returns, which is
   * the truth and should be shown).
   */
  const [localOrder, setLocalOrder] = useState<readonly T[] | null>(null);
  const itemsAtRelease = useRef<readonly T[] | null>(null);

  useEffect(() => {
    if (
      localOrder !== null &&
      itemsAtRelease.current !== null &&
      items !== itemsAtRelease.current
    ) {
      itemsAtRelease.current = null;
      setLocalOrder(null);
    }
  }, [items, localOrder]);

  const rows = localOrder ?? items;

  const offset = useRef(new Animated.Value(0)).current;

  /*
   * Measured heights, the live order, and the live target, in refs.
   *
   * The PanResponder is created once per render and closes over whatever it
   * captured, so anything it reads mid-drag has to be a ref — reading state
   * there is the stale-closure bug this codebase has hit more than once.
   */
  const heights = useRef<Map<string, number>>(new Map());
  const order = useRef<readonly T[]>(rows);
  order.current = rows;
  const targetRef = useRef<number | null>(null);

  /** One animated offset per row, so a shift does not re-render the list. */
  const shifts = useRef<Map<string, Animated.Value>>(new Map());
  const shiftFor_ = (key: string) => {
    const held = shifts.current.get(key);
    if (held !== undefined) return held;
    const created = new Animated.Value(0);
    shifts.current.set(key, created);
    return created;
  };

  useEffect(() => {
    onDragStateChange?.(dragging !== null);
  }, [dragging, onDragStateChange]);

  /* Animate every row to where the current target says it should sit. */
  useEffect(() => {
    const current = order.current;
    const from = dragging === null ? -1 : current.findIndex((item) => keyOf(item) === dragging);
    const height = dragging === null ? 0 : (heights.current.get(dragging) ?? 0);

    const animations = current.map((item, index) => {
      const to = from === -1 || target === null ? 0 : shiftFor(from, target, index, height);
      return Animated.timing(shiftFor_(keyOf(item)), {
        toValue: to,
        duration: SHIFT_MS,
        useNativeDriver: true,
      });
    });

    // `rows` is deliberately read through the ref rather than listed as a
    // dependency: a re-render mid-drag would otherwise restart the animation
    // from a stale order, which is a visible stutter under the finger.
    Animated.parallel(animations).start();
  }, [dragging, target, keyOf]);

  const stopDragging = () => {
    offset.setValue(0);
    targetRef.current = null;
    setTarget(null);
    setDragging(null);
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
      {rows.map((item) => {
        const key = keyOf(item);
        const isDragging = dragging === key;

        const responder = PanResponder.create({
          // The hold is what separates a drag from a tap, so the responder is
          // only claimed once the timer below has fired.
          onStartShouldSetPanResponder: () => false,
          onMoveShouldSetPanResponder: () => dragging === key,

          onPanResponderMove: (_event, gesture) => {
            offset.setValue(gesture.dy);

            const current = order.current;
            const from = current.findIndex((i) => keyOf(i) === key);
            const measured = current.map((i) => heights.current.get(keyOf(i)) ?? 0);
            const to = targetIndex(measured, from, gesture.dy);

            // Only when it changes: a setState per pixel would re-render the
            // whole list on every frame of the gesture.
            if (to !== targetRef.current) {
              targetRef.current = to;
              setTarget(to);
            }
          },

          onPanResponderRelease: (_event, gesture) => {
            const current = order.current;
            const from = current.findIndex((i) => keyOf(i) === key);
            const measured = current.map((i) => heights.current.get(keyOf(i)) ?? 0);
            const to = targetIndex(measured, from, gesture.dy);

            if (to !== from) {
              const next = reorder(current, from, to);
              // Shown immediately, replaced when the real data arrives.
              itemsAtRelease.current = items;
              setLocalOrder(next);
              // Every gap closes at once, and the row is already in its new
              // slot, so there is nothing left to animate back.
              for (const value of shifts.current.values()) value.setValue(0);
              stopDragging();
              onReorder(next.map(keyOf), key);
              return;
            }

            stopDragging();
          },

          onPanResponderTerminate: stopDragging,
        });

        let holdTimer: ReturnType<typeof setTimeout> | null = null;

        return (
          <Animated.View
            key={key}
            testID={`drag-row:${key}`}
            onLayout={(event) => {
              heights.current.set(key, event.nativeEvent.layout.height);
            }}
            onTouchStart={() => {
              holdTimer = setTimeout(() => setDragging(key), HOLD_MS);
            }}
            onTouchEnd={() => {
              if (holdTimer !== null) clearTimeout(holdTimer);
              // A hold that never became a drag never reaches the responder, so
              // without this the row stays picked up until the next gesture.
              if (dragging === key && targetRef.current === null) stopDragging();
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
              transform: [{ translateY: isDragging ? offset : shiftFor_(key) }],
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
