/**
 * Press-and-hold to drag a row into a new position.
 *
 * Built on React Native's own `PanResponder` and `Animated` rather than
 * `react-native-draggable-flatlist`. That package wants Reanimated 2 or 3 and
 * this project is on 4, and it needs a `GestureHandlerRootView` that is not
 * currently wired — so the dependency would be a compatibility gamble and a
 * native rebuild in exchange for a list of about six rows. The same reasoning
 * kept the community date picker out (docs/RELEASE.md).
 *
 * Rows are a fixed height so the arithmetic is exact: the drag offset divided
 * by the row height *is* the number of places moved. Measuring rows would mean
 * handling the frame where a height is not yet known, and the rows here are
 * uniform anyway.
 *
 * **Dragging is not the only way to reorder.** Every row keeps accessibility
 * actions for moving up and down, because a drag gesture is unusable with
 * VoiceOver and "it has a drag handle" is not an accessible reorder story.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, View } from 'react-native';

/** Uniform, and the unit the drag arithmetic is expressed in. */
export const ROW_HEIGHT = 56;

/** How long to hold before a press becomes a drag. */
const HOLD_MS = 220;

interface Props<T> {
  items: readonly T[];
  keyOf: (item: T) => string;
  /** Rendered inside the row; the row itself owns height and gestures. */
  renderItem: (item: T, dragging: boolean) => React.ReactNode;
  /** Called once, on release, with the new order. */
  onReorder: (orderedKeys: readonly string[]) => void;
  /** For the accessibility actions, e.g. `(c) => c.name`. */
  labelOf: (item: T) => string;
  /** Disables scrolling in the parent while a drag is in progress. */
  onDragStateChange?: (dragging: boolean) => void;
}

export function ReorderableList<T>({
  items,
  keyOf,
  renderItem,
  onReorder,
  labelOf,
  onDragStateChange,
}: Props<T>) {
  /**
   * A local copy, so the list can settle under the finger without waiting on
   * the server. The parent's mutation is optimistic too, but this also covers
   * the frames between release and the cache updating.
   */
  const [order, setOrder] = useState<readonly T[]>(items);
  useEffect(() => {
    setOrder(items);
  }, [items]);

  const [dragKey, setDragKey] = useState<string | null>(null);
  /** How many places the held row has moved from where it started. */
  const [offsetRows, setOffsetRows] = useState(0);

  const pan = useRef(new Animated.Value(0)).current;
  // Read inside PanResponder callbacks, which close over their first render.
  const orderRef = useRef(order);
  orderRef.current = order;
  const dragKeyRef = useRef<string | null>(null);
  const offsetRef = useRef(0);

  const setDragging = (key: string | null) => {
    dragKeyRef.current = key;
    setDragKey(key);
    onDragStateChange?.(key !== null);
  };

  const move = (from: number, to: number) => {
    const next = [...orderRef.current];
    const [item] = next.splice(from, 1);
    if (item === undefined) return;
    next.splice(to, 0, item);
    setOrder(next);
    onReorder(next.map(keyOf));
  };

  return (
    <View>
      {order.map((item, index) => (
        <Row
          key={keyOf(item)}
          index={index}
          total={order.length}
          label={labelOf(item)}
          isDragging={dragKey === keyOf(item)}
          pan={pan}
          offsetRows={offsetRows}
          dragIndex={dragKey === null ? null : order.findIndex((i) => keyOf(i) === dragKey)}
          onBeginDrag={() => {
            setDragging(keyOf(item));
            offsetRef.current = 0;
            setOffsetRows(0);
            pan.setValue(0);
          }}
          onDrag={(dy) => {
            pan.setValue(dy);
            const start = orderRef.current.findIndex((i) => keyOf(i) === dragKeyRef.current);
            const raw = Math.round(dy / ROW_HEIGHT);
            const clamped = Math.max(-start, Math.min(orderRef.current.length - 1 - start, raw));
            if (clamped !== offsetRef.current) {
              offsetRef.current = clamped;
              setOffsetRows(clamped);
            }
          }}
          onEndDrag={() => {
            const start = orderRef.current.findIndex((i) => keyOf(i) === dragKeyRef.current);
            const target = start + offsetRef.current;
            if (start !== -1 && target !== start) move(start, target);
            setDragging(null);
            offsetRef.current = 0;
            setOffsetRows(0);
            pan.setValue(0);
          }}
          onMoveBy={(delta) => {
            const target = index + delta;
            if (target >= 0 && target < orderRef.current.length) move(index, target);
          }}
        >
          {renderItem(item, dragKey === keyOf(item))}
        </Row>
      ))}
    </View>
  );
}

function Row({
  children,
  index,
  total,
  label,
  isDragging,
  pan,
  offsetRows,
  dragIndex,
  onBeginDrag,
  onDrag,
  onEndDrag,
  onMoveBy,
}: {
  children: React.ReactNode;
  index: number;
  total: number;
  label: string;
  isDragging: boolean;
  pan: Animated.Value;
  offsetRows: number;
  dragIndex: number | null;
  onBeginDrag: () => void;
  onDrag: (dy: number) => void;
  onEndDrag: () => void;
  onMoveBy: (delta: number) => void;
}) {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armed = useRef(false);

  const cancelHold = () => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const responder = useRef(
    PanResponder.create({
      // Never claim the touch on start: that would swallow taps on the Edit and
      // Delete controls and block the parent ScrollView.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => armed.current,
      onPanResponderGrant: onBeginDrag,
      onPanResponderMove: (_e, gesture) => onDrag(gesture.dy),
      onPanResponderRelease: () => {
        armed.current = false;
        onEndDrag();
      },
      onPanResponderTerminate: () => {
        armed.current = false;
        onEndDrag();
      },
      // Once dragging, do not let the ScrollView take the gesture back.
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  /**
   * Where this row sits while another one is being dragged over it.
   *
   * Rows between the held row's origin and its target shift one place in the
   * opposite direction, which is what makes the gap appear under the finger.
   */
  const shift =
    dragIndex === null || isDragging
      ? 0
      : dragIndex < index && index <= dragIndex + offsetRows
        ? -ROW_HEIGHT
        : dragIndex > index && index >= dragIndex + offsetRows
          ? ROW_HEIGHT
          : 0;

  return (
    <Animated.View
      {...responder.panHandlers}
      onTouchStart={() => {
        cancelHold();
        holdTimer.current = setTimeout(() => {
          armed.current = true;
        }, HOLD_MS);
      }}
      onTouchEnd={cancelHold}
      onTouchCancel={cancelHold}
      accessibilityActions={[
        { name: 'moveUp', label: 'Move up' },
        { name: 'moveDown', label: 'Move down' },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'moveUp') onMoveBy(-1);
        if (event.nativeEvent.actionName === 'moveDown') onMoveBy(1);
      }}
      accessibilityLabel={`${label}, ${index + 1} of ${total}. Hold and drag to reorder.`}
      style={{
        height: ROW_HEIGHT,
        justifyContent: 'center',
        transform: [{ translateY: isDragging ? pan : shift }],
        zIndex: isDragging ? 2 : 1,
        // Lifted rather than merely moved, so it is obvious which row is held.
        opacity: isDragging ? 0.94 : 1,
        ...(isDragging
          ? {
              shadowColor: '#000',
              shadowOpacity: 0.18,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 4 },
            }
          : {}),
      }}
    >
      {children}
    </Animated.View>
  );
}
