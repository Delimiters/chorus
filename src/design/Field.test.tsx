/**
 * What a field does when you run out of room.
 *
 * Emily hit the end of a chore name and the field simply stopped accepting
 * keystrokes — Jake: *"she was struggling with the name of the chore"*, and
 * Emily wanted it "more clear when you've hit a field's max length instead of
 * just not letting you type anymore".
 *
 * The mechanism is why there was nothing to react to: `maxLength` makes React
 * Native clip the text *before* `onChangeText` fires, so no event marks the
 * rejected keystroke. The only honest fix is to say where the boundary is
 * before you reach it, which is what these pin.
 *
 * jest-expo does no layout, so nothing here measures a box. What it can check is
 * the contract: the countdown appears at the right moment and not before, the
 * full state explains itself, and the limit is never dressed as an error.
 */
import { render, screen } from '@testing-library/react-native';
import { StrictMode } from 'react';
import { AccessibilityInfo } from 'react-native';

import { Field } from './components';
import { ThemeProvider } from './theme';

jest.mock('./haptics', () => ({ tapped: jest.fn(), finished: jest.fn(), celebrated: jest.fn() }));

const announce = jest
  .spyOn(AccessibilityInfo, 'announceForAccessibility')
  .mockImplementation(() => {});

const haptics = jest.requireMock('./haptics') as { tapped: jest.Mock };

beforeEach(() => {
  announce.mockClear();
  haptics.tapped.mockClear();
});

const show = (props: Parameters<typeof Field>[0]) =>
  render(
    <ThemeProvider>
      <Field {...props} />
    </ThemeProvider>,
  );

const chars = (n: number) => 'a'.repeat(n);

describe('the input itself', () => {
  it('answers to its label, which is how every form finds it', () => {
    /*
     * Pinned here because `Field`'s own suite did not: a review deleted
     * `accessibilityLabel` and all seventeen tests stayed green. It only went
     * red in `ChoreForm.test.tsx`, which queries `getByLabelText('Name')` — so
     * the primitive's contract was being guarded by its callers by accident.
     */
    show({ label: 'Name', value: 'bins', onChangeText: () => {} });

    expect(screen.getByLabelText('Name')).toBeOnTheScreen();
  });
});

describe('the countdown', () => {
  it('stays away until you are near the end', () => {
    // A quarter of 120 is 30, capped at 20 — so 99 characters is still quiet.
    show({ label: 'Name', value: chars(99), maxLength: 120, onChangeText: () => {} });

    expect(screen.queryByText(/left$/)).toBeNull();
  });

  it('appears once there are twenty characters of room left', () => {
    show({ label: 'Name', value: chars(100), maxLength: 120, onChangeText: () => {} });

    expect(screen.getByText('20 left')).toBeOnTheScreen();
  });

  it('counts down rather than counting up', () => {
    // "7 left" answers the question being asked. "113/120" makes you do the
    // subtraction yourself.
    show({ label: 'Name', value: chars(113), maxLength: 120, onChangeText: () => {} });

    expect(screen.getByText('7 left')).toBeOnTheScreen();
  });

  it('does not nag a short field from the first keystroke', () => {
    /*
     * A flat twenty-character threshold would put a counter on the
     * nine-character invite code the moment you started typing. A quarter of
     * nine is three, so it waits until there are three left.
     */
    show({ label: 'Code', value: chars(4), maxLength: 9, onChangeText: () => {} });
    expect(screen.queryByText(/left$/)).toBeNull();

    screen.rerender(
      <ThemeProvider>
        <Field label="Code" value={chars(6)} maxLength={9} onChangeText={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.getByText('3 left')).toBeOnTheScreen();
  });

  it('does not appear at all without a limit to count towards', () => {
    show({ label: 'Notes', value: chars(500), onChangeText: () => {} });

    expect(screen.queryByText(/left$/)).toBeNull();
  });
});

describe('being full', () => {
  it('says so, in characters', () => {
    show({ label: 'Name', value: chars(200), maxLength: 200, onChangeText: () => {} });

    expect(
      screen.getByText("You've used all 200 characters — that's the limit."),
    ).toBeOnTheScreen();
  });

  it('says it without the label, which cannot take an article', () => {
    /*
     * The sentence named the field as "a ${label}", which produced "a notes",
     * "a invite code" and "a household" across the app's nine capped fields.
     * The label is already on screen directly above the input.
     */
    show({ label: 'Notes', value: chars(2000), maxLength: 2000, onChangeText: () => {} });

    expect(screen.getByText(/You've used all 2000 characters/)).toBeOnTheScreen();
    expect(screen.queryByText(/a notes/i)).toBeNull();
  });

  it('replaces the countdown rather than sitting beside it', () => {
    // "0 left" next to "that's the longest it can be" says the same thing twice.
    show({ label: 'Name', value: chars(120), maxLength: 120, onChangeText: () => {} });

    expect(screen.queryByText('0 left')).toBeNull();
  });

  it('gives way to a real error, which is the more urgent thing', () => {
    show({
      label: 'Name',
      value: chars(120),
      maxLength: 120,
      error: 'Pick a different name.',
      onChangeText: () => {},
    });

    expect(screen.getByText('Pick a different name.')).toBeOnTheScreen();
    expect(screen.queryByText(/used all 120 characters/)).toBeNull();
  });

  it('takes the hint’s place while the field is full', () => {
    // The hint is advice for filling the field in; at the limit the useful
    // sentence is the one about the limit.
    show({
      label: 'Name',
      value: chars(120),
      maxLength: 120,
      hint: 'Short names read best.',
      onChangeText: () => {},
    });

    expect(screen.queryByText('Short names read best.')).toBeNull();
    expect(screen.getByText(/used all 120 characters/)).toBeOnTheScreen();
  });

  const back = (value: string, maxLength = 120) => (
    <ThemeProvider>
      <Field label="Name" value={value} maxLength={maxLength} onChangeText={() => {}} />
    </ThemeProvider>
  );

  it('is silent for a field that is already full when it appears', () => {
    /*
     * A field seeded from existing data can mount at its cap — open a note whose
     * title is exactly 120 characters, or edit a chore named right up to the
     * limit. Buzzing the phone and interrupting a screen reader for a limit the
     * reader did not just hit is startling and says nothing useful.
     */
    show({ label: 'Name', value: chars(120), maxLength: 120, onChangeText: () => {} });

    expect(haptics.tapped).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it('stays silent on mount even when effects run twice', () => {
    /*
     * StrictMode double-invokes effects in development — mount, cleanup, mount —
     * and the second pass used to see a ref that was no longer the sentinel,
     * decide it was not the first run, and buzz for a field that merely opened
     * full. The cleanup that restores the sentinel is what this pins.
     */
    render(
      <StrictMode>
        <ThemeProvider>
          <Field label="Name" value={chars(120)} maxLength={120} onChangeText={() => {}} />
        </ThemeProvider>
      </StrictMode>,
    );

    expect(haptics.tapped).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it('buzzes when you arrive at the limit', () => {
    show({ label: 'Name', value: chars(119), maxLength: 120, onChangeText: () => {} });
    expect(haptics.tapped).not.toHaveBeenCalled();

    screen.rerender(back(chars(120)));
    expect(haptics.tapped).toHaveBeenCalledTimes(1);
  });

  it('speaks the limit, which is the only way it reaches a screen reader', () => {
    // The counter is not focused and the input's value has stopped changing, so
    // nothing else announces it.
    show({ label: 'Name', value: chars(119), maxLength: 120, onChangeText: () => {} });
    screen.rerender(back(chars(120)));

    expect(announce).toHaveBeenCalledWith('Full at 120 characters');
  });

  it('does not buzz again on every render that stays full', () => {
    show({ label: 'Name', value: chars(119), maxLength: 120, onChangeText: () => {} });
    screen.rerender(back(chars(120)));
    screen.rerender(back(chars(120)));

    expect(haptics.tapped).toHaveBeenCalledTimes(1);
  });

  it('buzzes again after you delete something and fill it back up', () => {
    show({ label: 'Name', value: chars(119), maxLength: 120, onChangeText: () => {} });
    screen.rerender(back(chars(120)));
    screen.rerender(back(chars(119)));
    screen.rerender(back(chars(120)));

    expect(haptics.tapped).toHaveBeenCalledTimes(2);
  });
});

describe('a field with nothing to say', () => {
  it('renders no footer row, so the fields below it do not move', () => {
    /*
     * The row holds the hint, the error and the countdown. Rendering it empty
     * under every field in the app would add permanent space below all of them
     * — and the reason a countdown is safe to add at all is that it appears in
     * a row that is already there by the time it matters.
     */
    show({ label: 'Name', value: 'bins', maxLength: 120, onChangeText: () => {} });

    /*
     * The row itself, not just its contents. This asserted only the absence of
     * the countdown and the limit sentence — both already pinned elsewhere — so
     * it survived rendering the row unconditionally, which is the exact
     * regression its name claims to prevent. A review caught that by mutation.
     */
    expect(screen.queryByTestId('field-footer')).toBeNull();
  });

  it('renders the footer row as soon as it has a hint to put in it', () => {
    // The counter is safe to add precisely because by the time it matters the
    // row is usually already there.
    show({
      label: 'Name',
      value: 'bins',
      maxLength: 120,
      hint: 'Keep it short.',
      onChangeText: () => {},
    });

    expect(screen.getByTestId('field-footer')).toBeOnTheScreen();
  });
});
