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

import { reorder, targetIndex } from '@/core/plan/reorder';

/** How long to hold before a press becomes a drag rather than a tap. */
const HOLD_MS = 220;

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
  const offset = useRef(new Animated.Value(0)).current;

  /*
   * Measured heights, and the live order, in refs.
   *
   * The PanResponder is created once and closes over whatever it captured, so
   * anything it reads mid-drag has to be a ref — reading state there is the
   * stale-closure bug this codebase has hit more than once.
   */
  const heights = useRef<Map<string, number>>(new Map());
  const order = useRef<readonly T[]>(items);
  order.current = items;

  useEffect(() => {
    onDragStateChange?.(dragging !== null);
  }, [dragging, onDragStateChange]);

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

        const responder = PanResponder.create({
          // The hold is what separates a drag from a tap, so the responder is
          // only claimed once the timer below has fired.
          onStartShouldSetPanResponder: () => false,
          onMoveShouldSetPanResponder: () => dragging === key,

          onPanResponderMove: (_event, gesture) => {
            offset.setValue(gesture.dy);
          },

          onPanResponderRelease: (_event, gesture) => {
            const current = order.current;
            const from = current.findIndex((i) => keyOf(i) === key);
            const measured = current.map((i) => heights.current.get(keyOf(i)) ?? 0);
            const to = targetIndex(measured, from, gesture.dy);

            offset.setValue(0);
            setDragging(null);
            if (to !== from) onReorder(reorder(current, from, to).map(keyOf), key);
          },

          onPanResponderTerminate: () => {
            offset.setValue(0);
            setDragging(null);
          },
        });

        let holdTimer: ReturnType<typeof setTimeout> | null = null;

        return (
          <View
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
            }}
            accessibilityActions={[
              { name: 'moveUp', label: `Move ${labelOf(item)} up` },
              { name: 'moveDown', label: `Move ${labelOf(item)} down` },
            ]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'moveUp') move(key, -1);
              if (event.nativeEvent.actionName === 'moveDown') move(key, 1);
            }}
            {...responder.panHandlers}
          >
            <Animated.View
              style={
                isDragging
                  ? {
                      transform: [{ translateY: offset }],
                      // Lifted, so it is obvious which row is in your hand and
                      // that it is above the others rather than between them.
                      zIndex: 2,
                      elevation: 4,
                      opacity: 0.95,
                    }
                  : undefined
              }
            >
              {renderItem(item, isDragging)}
            </Animated.View>
          </View>
        );
      })}
    </View>
  );
}
