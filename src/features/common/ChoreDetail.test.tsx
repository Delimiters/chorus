/**
 * The steps list, which is what made the sheet too tall to escape.
 *
 * Jake, on a chore with a lot of them: *"it took up the whole screen and was
 * too big for it and I couldn't back out of it without either closing the app
 * or picking one of the options that actually showed up on the screen."*
 *
 * `Sheet` is capped now so that can no longer happen — but a cap alone would
 * just squeeze the actions into a sliver, because this list was the part
 * growing without limit. Collapsing it is what keeps the sheet short enough
 * that both halves fit.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '@/design/theme';
import { MIN_TARGET, palette, radius } from '@/design/tokens';

import { ChoreDetail } from './ChoreDetail';

const steps = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: `Step ${i + 1}` }));

const renderDetail = (count: number) =>
  render(
    <ThemeProvider>
      <ChoreDetail subtasks={steps(count)} onToggleSubtask={jest.fn()} />
    </ThemeProvider>,
  );

describe('a short list of steps', () => {
  it('shows all of them, with nothing to expand', () => {
    renderDetail(5);

    expect(screen.getByText('Step 5')).toBeTruthy();
    expect(screen.queryByText(/Show all/)).toBeNull();
  });
});

describe('a long list of steps', () => {
  it('shows the first few and says how many there are', () => {
    renderDetail(18);

    expect(screen.getByText('Step 5')).toBeTruthy();
    expect(screen.queryByText('Step 6')).toBeNull();
    // The count in the heading is the whole list, not what is on screen —
    // otherwise collapsing would quietly change what the chore says it is.
    expect(screen.getByText('0 OF 18 STEPS')).toBeTruthy();
    expect(screen.getByText('Show all 18 steps')).toBeTruthy();
  });

  it('shows the rest when asked, and takes them back again', () => {
    renderDetail(18);

    fireEvent.press(screen.getByText('Show all 18 steps'));
    expect(screen.getByText('Step 18')).toBeTruthy();

    fireEvent.press(screen.getByText('Show fewer'));
    expect(screen.queryByText('Step 18')).toBeNull();
  });

  /*
   * The expander is a control, and this project has a standing rule about
   * controls: 44pt or it gets missed. A text row is exactly the kind that
   * comes out at 20.
   */
  it('has a real tap target', () => {
    renderDetail(18);

    const toggle = screen.getByRole('button', { name: 'Show all 18 steps' });

    expect(toggle.props.style).toMatchObject({ minHeight: MIN_TARGET });
  });

  /*
   * Jake: *"it hardly looks like something clickable."* A ground and a pill
   * edge are what make it read as a control rather than as prose, so they are
   * worth pinning — a later tidy that drops them puts the complaint back.
   */
  it('looks like a control rather than a line of text', () => {
    renderDetail(18);

    const toggle = screen.getByRole('button', { name: /Show all 18 steps/ });

    /*
     * The real values, not `expect.any`.
     *
     * `expect.any(Number)` passes against `borderRadius: 0` and
     * `expect.any(String)` against `'transparent'` — so the test written to
     * stop a later tidy dropping the ground would have stayed green through
     * exactly that tidy. jest resolves to the light theme, so the expected
     * values are deterministic.
     */
    expect(toggle.props.style).toMatchObject({
      borderRadius: radius.pill,
      backgroundColor: palette.light.raised,
      // As wide as its label, so it does not read as a section header.
      alignSelf: 'flex-start',
    });
  });

  it('announces whether it is open, for anyone not looking at the chevron', () => {
    renderDetail(18);

    const toggle = screen.getByRole('button', { name: /Show all 18 steps/ });
    expect(toggle.props.accessibilityState).toMatchObject({ expanded: false });

    fireEvent.press(toggle);
    expect(
      screen.getByRole('button', { name: /Show fewer/ }).props.accessibilityState,
    ).toMatchObject({ expanded: true });
  });
});
