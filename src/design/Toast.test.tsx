/**
 * The toast, on its own.
 *
 * It had no unit tests at all — an odd gap for a shared component that two
 * screens depend on, and the reason a countdown bar, an `AccessibilityInfo`
 * listener and a new prop could all be added without anything being able to
 * fail. Flipping the `countdown` default to `true`, or dropping the Reduce
 * Motion check, was green across the whole suite.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type React from 'react';
import { AccessibilityInfo } from 'react-native';

import { ThemeProvider } from './theme';
import { Toast, TOAST_MS } from './Toast';

/** Every render needs the theme, same as the other design tests. */
const show = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);
const reshow = (rerender: (ui: React.ReactElement) => void, ui: React.ReactElement) =>
  rerender(<ThemeProvider>{ui}</ThemeProvider>);

const bar = () => screen.queryByTestId('toast-countdown', { includeHiddenElements: true });

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('a toast with something to undo', () => {
  it('draws the countdown only when asked', () => {
    const { rerender } = show(<Toast message="Dishes — done" onDismiss={() => {}} />);
    // No `countdown` prop: a plain message makes no promise about expiring.
    expect(bar()).toBeNull();

    reshow(rerender, <Toast message="Dishes — done" onDismiss={() => {}} countdown />);
    expect(bar()).not.toBeNull();
  });

  it('dismisses itself after five seconds', () => {
    const onDismiss = jest.fn();
    show(<Toast message="Dishes — done" onDismiss={onDismiss} countdown />);

    act(() => {
      jest.advanceTimersByTime(TOAST_MS - 100);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('runs the action without dismissing itself', () => {
    /*
     * The owner decides what happens after `Undo` — it may need to say
     * something else — so this must not quietly clear itself first.
     */
    const onAction = jest.fn();
    show(
      <Toast message="Dishes — done" actionLabel="Undo" onAction={onAction} onDismiss={() => {}} />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Dishes — done')).toBeOnTheScreen();
  });
});

describe('restarting the clock', () => {
  it('restarts on a new message', () => {
    const onDismiss = jest.fn();
    const { rerender } = show(<Toast message="Dishes — done" onDismiss={onDismiss} countdown />);

    act(() => {
      jest.advanceTimersByTime(TOAST_MS - 200);
    });
    reshow(rerender, <Toast message="Trash — done" onDismiss={onDismiss} countdown />);

    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('restarts on a new restartKey, even when the words are identical', () => {
    /*
     * Two chores can share a label. Keyed on the text alone, the second undo
     * inherited whatever was left of the first one's five seconds — here, 200
     * milliseconds.
     */
    const onDismiss = jest.fn();
    const { rerender } = show(
      <Toast message="Dishes — done" onDismiss={onDismiss} countdown restartKey={1} />,
    );

    act(() => {
      jest.advanceTimersByTime(TOAST_MS - 200);
    });
    reshow(
      rerender,
      <Toast message="Dishes — done" onDismiss={onDismiss} countdown restartKey={2} />,
    );

    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('does not restart on an unchanged message', () => {
    /*
     * The other half of the rule, and why `restartKey` exists rather than the
     * message simply being re-keyed: a repeated *error* must not reset a toast
     * you are part-way through reading.
     */
    const onDismiss = jest.fn();
    const { rerender } = show(<Toast message="Network request failed" onDismiss={onDismiss} />);

    act(() => {
      jest.advanceTimersByTime(TOAST_MS - 200);
    });
    reshow(rerender, <Toast message="Network request failed" onDismiss={onDismiss} />);

    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('under Reduce Motion', () => {
  it('drops the bar but keeps the message and the action', async () => {
    /*
     * A bar whose entire content is movement has nothing to say when it cannot
     * move, and a static full-width line reads as a progress bar that has
     * stuck. What it must not do is take the undo with it.
     */
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

    show(
      <Toast
        message="Dishes — done"
        actionLabel="Undo"
        onAction={() => {}}
        onDismiss={() => {}}
        countdown
      />,
    );

    await act(async () => {});

    expect(bar()).toBeNull();
    expect(screen.getByText('Dishes — done')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeOnTheScreen();
  });

  it('still dismisses itself on time', () => {
    /*
     * The bar is cosmetic and the timeout is the truth — so turning the bar
     * off must not leave a toast that never goes away.
     */
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const onDismiss = jest.fn();

    show(<Toast message="Dishes — done" onDismiss={onDismiss} countdown />);

    act(() => {
      jest.advanceTimersByTime(TOAST_MS + 100);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('nothing to say', () => {
  it('renders nothing at all for a null message', () => {
    show(<Toast message={null} onDismiss={() => {}} countdown />);
    expect(bar()).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('starts no timer for a null message', () => {
    const onDismiss = jest.fn();
    show(<Toast message={null} onDismiss={onDismiss} />);

    act(() => {
      jest.advanceTimersByTime(TOAST_MS * 3);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
