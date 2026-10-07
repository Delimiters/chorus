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

import { Field } from './components';
import { ThemeProvider } from './theme';

jest.mock('./haptics', () => ({ tapped: jest.fn(), finished: jest.fn(), celebrated: jest.fn() }));

const show = (props: Parameters<typeof Field>[0]) =>
  render(
    <ThemeProvider>
      <Field {...props} />
    </ThemeProvider>,
  );

const chars = (n: number) => 'a'.repeat(n);

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
  it('says so, in characters, naming the field', () => {
    show({ label: 'Name', value: chars(200), maxLength: 200, onChangeText: () => {} });

    expect(
      screen.getByText("That's the longest a name can be — 200 characters."),
    ).toBeOnTheScreen();
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
    expect(screen.queryByText(/longest a name can be/)).toBeNull();
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
    expect(screen.getByText(/longest a name can be/)).toBeOnTheScreen();
  });

  it('buzzes once on arrival, not on every render that stays full', () => {
    const { tapped } = jest.requireMock('./haptics') as { tapped: jest.Mock };
    tapped.mockClear();

    show({ label: 'Name', value: chars(120), maxLength: 120, onChangeText: () => {} });
    expect(tapped).toHaveBeenCalledTimes(1);

    screen.rerender(
      <ThemeProvider>
        <Field label="Name" value={chars(120)} maxLength={120} onChangeText={() => {}} />
      </ThemeProvider>,
    );
    expect(tapped).toHaveBeenCalledTimes(1);
  });

  it('buzzes again after you delete something and fill it back up', () => {
    const { tapped } = jest.requireMock('./haptics') as { tapped: jest.Mock };
    tapped.mockClear();

    show({ label: 'Name', value: chars(120), maxLength: 120, onChangeText: () => {} });
    const back = (value: string) => (
      <ThemeProvider>
        <Field label="Name" value={value} maxLength={120} onChangeText={() => {}} />
      </ThemeProvider>
    );
    screen.rerender(back(chars(119)));
    screen.rerender(back(chars(120)));

    expect(tapped).toHaveBeenCalledTimes(2);
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

    expect(screen.queryByText(/left$/)).toBeNull();
    expect(screen.queryByText(/longest/)).toBeNull();
  });
});
