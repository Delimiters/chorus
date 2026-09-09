/**
 * A scrolling form whose controls can put you back where you were.
 *
 * Several of the chore form's controls open a panel inline — the icon grid, the
 * time wheel, the new-category fields. Opening one makes the content taller;
 * choosing something closes it and makes the content shorter again. A
 * `ScrollView` holds its offset through both, so the shrink slides everything
 * up past you and you end up somewhere further down the form than where you
 * were working. Jake: *"when you're finished picking the icon, it just leaves
 * you in the same spot but the scrollview shrinks again... and you're suddenly
 * scrolled way further down. It should return you back the icon selector area
 * so you can continue going through the flow."*
 *
 * The fix is to scroll back to the section that closed. It cannot be done by
 * remembering the offset from before the panel opened, because that is the
 * wrong answer whenever the panel opened while already scrolled — the section's
 * own position is the thing that is stable, and it does not move when something
 * *inside* it collapses.
 *
 * ── Why an anchor rather than `maintainVisibleContentPosition` ─────────────
 *
 * That prop keeps the topmost visible child pinned, which is right for content
 * inserted above the viewport and wrong here: the thing being looked at is the
 * panel itself, and it is about to stop existing. There is nothing to pin to.
 */

import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';
import { ScrollView, type LayoutChangeEvent, type ScrollViewProps } from 'react-native';

import { space } from '@/design/tokens';

/**
 * A little of the section's surroundings, so the label above it stays visible
 * and the result reads as "here is where you were" rather than as a cut.
 */
export const ANCHOR_INSET = space.lg;

interface FormScrollApi {
  /**
   * Scrolls to `y`, but only when the form has been scrolled past it.
   *
   * The conditional half matters as much as the scroll. A section that is still
   * on screen has not been pushed anywhere, and scrolling to it anyway would
   * *cause* the jump this exists to prevent — open the icon grid from the top
   * of a fresh form, pick something, and an unconditional version would drag
   * you down to the icon row you were already looking at.
   */
  returnTo: (y: number) => void;
}

const FormScrollContext = createContext<FormScrollApi | null>(null);

export function FormScroll({
  children,
  onScroll,
  ...props
}: ScrollViewProps & { children: ReactNode }) {
  const ref = useRef<ScrollView>(null);
  /* A ref, not state: nothing renders from it, and re-rendering the whole form
     on every frame of a scroll would be a real cost for no effect. */
  const offset = useRef(0);

  const api = useMemo<FormScrollApi>(
    () => ({
      returnTo: (y) => {
        if (offset.current > y) ref.current?.scrollTo({ y, animated: true });
      },
    }),
    [],
  );

  return (
    <FormScrollContext.Provider value={api}>
      <ScrollView
        ref={ref}
        onScroll={(event) => {
          offset.current = event.nativeEvent.contentOffset.y;
          onScroll?.(event);
        }}
        // Without this iOS reports the offset once per gesture, so a fast flick
        // past a section would leave the anchor believing you never moved.
        scrollEventThrottle={16}
        {...props}
      >
        {children}
      </ScrollView>
    </FormScrollContext.Provider>
  );
}

/**
 * Marks one section as somewhere worth returning to.
 *
 * Spread `anchorProps` onto a **direct child of the scroll view's content
 * container**, and nothing else.
 *
 * `onLayout` reports a position relative to the parent. On a nested view that
 * is an offset *within* the parent — near zero for anything at the top of its
 * own wrapper — so `returnTo` is handed a y of about zero and scrolls to the
 * top of the whole form. That is strictly worse than doing nothing, and it is
 * worth being blunt about: an earlier version of this comment called it
 * "returning to the enclosing section", which it is not, and which would have
 * read as permission to nest one.
 */
export function useAnchor(): {
  anchorProps: { onLayout: (event: LayoutChangeEvent) => void };
  returnHere: () => void;
} {
  const api = useContext(FormScrollContext);
  const y = useRef<number | null>(null);

  return {
    anchorProps: {
      onLayout: (event) => {
        y.current = event.nativeEvent.layout.y;
      },
    },
    /*
     * Measured before the collapse rather than after, which is the same number:
     * a section's top edge does not move when something inside it shrinks.
     * Everything below it moves, which is exactly the problem being fixed.
     */
    returnHere: () => {
      if (y.current !== null) api?.returnTo(Math.max(0, y.current - ANCHOR_INSET));
    },
  };
}
