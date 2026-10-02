/**
 * The sheet has to stay escapable, however much is in it.
 *
 * Jake, on a chore with a lot of subtasks: *"it took up the whole screen and
 * was too big for it and I couldn't back out of it without either closing the
 * app or picking one of the options that actually showed up on the screen."*
 *
 * The mechanism is worth stating because it is not obvious from the markup: the
 * backdrop is a `flex: 1` sibling *above* a bottom-anchored sheet, so a sheet
 * tall enough to fill the screen squeezes the backdrop to nothing — and the
 * backdrop is the way out. The height cap is what guarantees there is always
 * some left to tap, which makes it a correctness rule rather than a matter of
 * taste.
 *
 * jest-expo does no layout, so none of this can be checked by measuring a
 * rendered box. What it can check is the contract: the cap is applied, the body
 * is a scroll view, the footer sits outside it, and the labelled way out exists
 * no matter how much goes in.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Keyboard, ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Sheet, SheetAction } from './Sheet';
import { ThemeProvider } from './theme';

/**
 * As much of a rendered node as these assertions need.
 *
 * `react-test-renderer` ships no types and the project does not depend on
 * `@types/react-test-renderer`, so naming the two fields used here beats
 * pulling in a package for one import.
 */
interface Node {
  readonly props: { readonly style?: unknown; readonly children?: unknown };
}

const WINDOW_HEIGHT = 844;

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({
    children,
    style,
  }: {
    children: React.ReactNode;
    style?: StyleProp<ViewStyle>;
  }) => {
    const { View: RNView } = jest.requireActual<typeof import('react-native')>('react-native');
    return <RNView style={style}>{children}</RNView>;
  },
}));

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));

const onClose = jest.fn();

/** Enough rows that the sheet would have overflowed before the cap. */
const manySubtasks = Array.from({ length: 40 }, (_, i) => (
  <Text key={i}>{`Subtask ${i + 1}`}</Text>
));

const renderSheet = (props: { footer?: React.ReactNode } = {}) =>
  render(
    <ThemeProvider>
      <Sheet
        visible
        onClose={onClose}
        title="Deep clean the kitchen"
        subtitle="Due Tue 29 Sep"
        {...props}
      >
        <View>{manySubtasks}</View>
      </Sheet>
    </ThemeProvider>,
  );

beforeEach(() => {
  onClose.mockClear();
});

describe('a sheet with more in it than fits', () => {
  it('leaves room for the backdrop rather than filling the screen', () => {
    renderSheet();

    // The cap is on the sheet's own container. Below the window height by a
    // real margin, because the remainder *is* the way out.
    const maxHeightOf = (node: Node): number | undefined => {
      const style = node.props.style as { maxHeight?: number } | undefined;
      return typeof style?.maxHeight === 'number' ? style.maxHeight : undefined;
    };
    const capped = screen.UNSAFE_root.findAll((node: Node) => maxHeightOf(node) !== undefined);

    expect(capped.length).toBeGreaterThan(0);
    expect(maxHeightOf(capped[0] as Node)).toBeLessThan(WINDOW_HEIGHT * 0.9);

    /*
     * A shape assertion rather than a behavioural one, and deliberately so.
     *
     * React Native defaults `flexShrink` to **0**, unlike CSS — so without this
     * the sheet keeps its content's height inside a container that has become
     * smaller than the cap (the keyboard case) and the backdrop absorbs the
     * whole loss. jest-expo runs no layout engine, so nothing here can observe
     * the consequence; pinning the property is the most this suite can do, and
     * it is worth doing because the default is the trap.
     */
    const style = (capped[0] as Node).props.style as { flexShrink?: number };
    expect(style.flexShrink).toBe(1);
  });

  it('can still be dismissed, which is the whole bug', () => {
    renderSheet();

    fireEvent.press(screen.getByLabelText('Close'));

    expect(onClose).toHaveBeenCalled();
  });

  it('scrolls its body rather than pushing it off the screen', () => {
    renderSheet();

    expect(screen.UNSAFE_getAllByType(ScrollView).length).toBeGreaterThan(0);
    // And the content is really inside it, not beside it.
    expect(screen.getByText('Subtask 40')).toBeTruthy();
  });

  it('keeps the title out of the scroll, so you can see what you are looking at', () => {
    renderSheet();

    const scroll = screen.UNSAFE_getAllByType(ScrollView)[0];
    const inScroll = scroll?.findAll(
      (node: Node) => node.props.children === 'Deep clean the kitchen',
    );

    expect(screen.getByText('Deep clean the kitchen')).toBeTruthy();
    expect(inScroll).toHaveLength(0);
  });
});

describe('the pinned footer', () => {
  it('keeps the actions out of the scroll, so they cannot scroll away', () => {
    renderSheet({ footer: <SheetAction label="Mark it done" onPress={jest.fn()} /> });

    const scroll = screen.UNSAFE_getAllByType(ScrollView)[0];
    const inScroll = scroll?.findAll((node: Node) => node.props.children === 'Mark it done');

    expect(screen.getByText('Mark it done')).toBeTruthy();
    expect(inScroll).toHaveLength(0);
  });

  it('is simply absent when nothing is passed', () => {
    renderSheet();

    expect(screen.queryByText('Mark it done')).toBeNull();
  });
});

/*
 * The keyboard, which is the case the first version of the cap got wrong.
 *
 * `KeyboardAvoidingView` shrinks the container the sheet lives in, but a
 * `maxHeight` measured against the whole window does not notice — it keeps that
 * height inside the smaller container and overflows it, taking the backdrop
 * with it. `useKeyboardHeight`'s docblock says exactly this, about exactly this
 * mistake, and the cap was written without it.
 */
describe('with the keyboard up', () => {
  const capsOf = () => {
    const found = screen.UNSAFE_root.findAll((node: Node) => {
      const style = node.props.style as { maxHeight?: number } | undefined;
      return typeof style?.maxHeight === 'number';
    });
    return found.map((node: Node) => (node.props.style as { maxHeight: number }).maxHeight);
  };

  it('measures the cap against what is left of the screen, not the whole of it', () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const spy = jest.spyOn(Keyboard, 'addListener').mockImplementation(((
      event: string,
      handler: (payload: unknown) => void,
    ) => {
      listeners.set(event, handler);
      return { remove: () => listeners.delete(event) };
    }) as never);

    renderSheet();
    const before = capsOf()[0] as number;

    act(() => {
      listeners.get('keyboardWillShow')?.({ endCoordinates: { height: 336 } });
    });

    const after = capsOf()[0] as number;
    expect(after).toBeLessThan(before);
    // And by the keyboard's share of it, not some arbitrary amount — the
    // backdrop's existence is the thing this arithmetic is protecting.
    expect(before - after).toBeCloseTo(336 * 0.86, 1);

    spy.mockRestore();
  });
});
