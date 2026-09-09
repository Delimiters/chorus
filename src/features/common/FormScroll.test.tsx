/**
 * Returning to the control you were using.
 *
 * The defect this guards is a scroll offset, which jest-expo cannot see — it
 * runs no layout, so nothing here shrinks and nothing scrolls on its own. What
 * *is* observable is the call: a section reports its position through
 * `onLayout`, and closing a panel inside it must ask the scroll view to go back
 * there. If that call stops happening the fix is gone, whatever the layout
 * would have done.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView, View } from 'react-native';

import { ThemeProvider } from '@/design/theme';
import { IconPicker } from './IconPicker';
import { ANCHOR_INSET, FormScroll, useAnchor } from './FormScroll';

const SECTION_Y = 840;

/*
 * `useAnchor` reads a context the scroll view provides, so one component cannot
 * both render the `FormScroll` and call the hook — the hook would run a level
 * above the provider and find nothing. Split in two, the way the chore form is.
 */
function Wrapped() {
  return (
    <FormScroll testID="form-scroll">
      <Inner />
    </FormScroll>
  );
}

function Inner() {
  const anchor = useAnchor();
  return (
    <View testID="section" {...anchor.anchorProps}>
      <IconPicker value={null} onChange={jest.fn()} onCollapse={anchor.returnHere} />
    </View>
  );
}

let scrollSpy: jest.SpyInstance;

beforeEach(() => {
  scrollSpy = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  scrollSpy.mockRestore();
});

const layOutSection = () =>
  fireEvent(screen.getByTestId('section'), 'layout', {
    nativeEvent: { layout: { x: 0, y: SECTION_Y, width: 320, height: 60 } },
  });

/** Scrolling down through the open panel, which is what displaces the section. */
const scrollTo = (y: number) =>
  fireEvent.scroll(screen.getByTestId('form-scroll'), {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 320, height: 4000 },
      layoutMeasurement: { width: 320, height: 800 },
    },
  });

const renderHarness = () =>
  render(
    <ThemeProvider>
      <Wrapped />
    </ThemeProvider>,
  );

describe('choosing something from a panel that then closes', () => {
  it('scrolls back to the section that closed', () => {
    renderHarness();
    layOutSection();

    fireEvent.press(screen.getByRole('button', { name: 'Choose an icon' }));
    scrollTo(SECTION_Y + 600); // down through the grid
    fireEvent.press(screen.getByRole('radio', { name: 'car' }));

    expect(scrollSpy).toHaveBeenCalledWith({ y: SECTION_Y - ANCHOR_INSET, animated: true });
  });

  it('scrolls back when the panel is dismissed rather than used', () => {
    // Closing it by hand shrinks the content by exactly as much as choosing
    // does, so it needs the same treatment.
    renderHarness();
    layOutSection();

    fireEvent.press(screen.getByRole('button', { name: 'Choose an icon' }));
    scrollTo(SECTION_Y + 600);
    fireEvent.press(screen.getByRole('button', { name: 'Close the icon list' }));

    expect(scrollSpy).toHaveBeenCalledWith({ y: SECTION_Y - ANCHOR_INSET, animated: true });
  });

  it('does not scroll while the panel is merely open', () => {
    // Opening it grows the content downwards, which pushes nothing past you.
    renderHarness();
    layOutSection();

    fireEvent.press(screen.getByRole('button', { name: 'Choose an icon' }));

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it('leaves a section alone when it is still on screen', () => {
    /*
     * Found on the simulator, not here. Opening the grid from the top of a
     * fresh form and picking an icon displaces nothing — the section is still
     * where you left it — so scrolling to it would be the jump rather than the
     * fix.
     */
    renderHarness();
    layOutSection();

    fireEvent.press(screen.getByRole('button', { name: 'Choose an icon' }));
    scrollTo(0);
    fireEvent.press(screen.getByRole('radio', { name: 'car' }));

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it('stays put rather than jumping to the top when the section never laid out', () => {
    /*
     * `onLayout` has not fired, so there is no position to return to. Treating
     * a missing measurement as zero would scroll to the top of the form, which
     * is a worse version of the bug being fixed.
     */
    renderHarness();

    fireEvent.press(screen.getByRole('button', { name: 'Choose an icon' }));
    scrollTo(SECTION_Y + 600);
    fireEvent.press(screen.getByRole('radio', { name: 'car' }));

    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
