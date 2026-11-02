/**
 * The chore link picker, which was 221 chips.
 *
 * Jake: *"you just get a gigantic list of every chore there is. It is very hard
 * to find the right one and just a terrible design. You should have like a
 * searchable dropdown instead"*. A full rewrite with no tests was most of the
 * risk in that change.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Chore } from '@/data/api/chores';
import { ThemeProvider } from '@/design/theme';

import { ChoreLinkPicker } from './ChoreLinkPicker';

const chore = (id: string, title: string, archived = false): Chore =>
  ({ id, title, archived }) as unknown as Chore;

const show = (chores: readonly Chore[], value: string | null, onChange = jest.fn()) => {
  render(
    <ThemeProvider>
      <ChoreLinkPicker chores={chores} value={value} onChange={onChange} />
    </ThemeProvider>,
  );
  return onChange;
};

/** Enough to be past the cap, and nameable so a query can hit one. */
const many = Array.from({ length: 30 }, (_, i) =>
  chore(`c${String(i)}`, `Chore number ${String(i)}`),
);

describe('finding a chore among many', () => {
  it('shows a handful rather than all of them', () => {
    show(many, null);

    // Six, not thirty. The whole complaint was the wall.
    expect(screen.queryAllByText(/^Chore number/)).toHaveLength(6);
    expect(screen.getByText(/24 more/)).toBeOnTheScreen();
  });

  it('narrows to what was typed', () => {
    show(many, null);

    fireEvent.changeText(screen.getByLabelText('Search chores'), 'number 17');

    expect(screen.queryAllByText(/^Chore number/)).toHaveLength(1);
    expect(screen.getByText('Chore number 17')).toBeOnTheScreen();
  });

  it('matches anywhere in the name, not just the start', () => {
    show([chore('a', 'Scoop the litter box'), chore('b', 'Water the plants')], null);

    fireEvent.changeText(screen.getByLabelText('Search chores'), 'litter');

    expect(screen.getByText('Scoop the litter box')).toBeOnTheScreen();
    expect(screen.queryByText('Water the plants')).toBeNull();
  });

  it('says so when nothing matches, rather than looking empty', () => {
    show(many, null);

    fireEvent.changeText(screen.getByLabelText('Search chores'), 'zzzz');

    expect(screen.getByText(/Nothing matching/)).toBeOnTheScreen();
    expect(screen.queryAllByText(/^Chore number/)).toHaveLength(0);
  });

  it('reports the chore that was picked', () => {
    const onChange = show(many, null);

    fireEvent.press(screen.getByText('Chore number 3'));

    expect(onChange).toHaveBeenCalledWith('c3');
  });

  it('does not offer an archived chore', () => {
    show([chore('a', 'Live one'), chore('b', 'Archived one', true)], null);

    expect(screen.getByText('Live one')).toBeOnTheScreen();
    expect(screen.queryByText('Archived one')).toBeNull();
  });
});

describe('once something is linked', () => {
  it('shows the choice instead of going on asking', () => {
    show(many, 'c3');

    expect(screen.getByText('Chore number 3')).toBeOnTheScreen();
    // No search box: the question has been answered.
    expect(screen.queryByLabelText('Search chores')).toBeNull();
    expect(screen.queryByText(/more/)).toBeNull();
  });

  it('can be cleared', () => {
    const onChange = show(many, 'c3');

    fireEvent.press(screen.getByLabelText('Unlink this chore'));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('shows a link to a since-archived chore, and lets it be cleared', () => {
    /*
     * The dead end this rewrite nearly shipped. `selected` was resolved from
     * the *live* list, so a link made before the chore was archived rendered as
     * unlinked — and since Clear only appears once something is found, the link
     * could never be removed from this screen.
     */
    const onChange = show([chore('a', 'Live one'), chore('b', 'Gone now', true)], 'b');

    expect(screen.getByText('Gone now (archived)')).toBeOnTheScreen();

    fireEvent.press(screen.getByLabelText('Unlink this chore'));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('a household with nothing to link to', () => {
  it('says so rather than showing an empty search', () => {
    show([], null);

    expect(screen.getByText(/No chores yet/)).toBeOnTheScreen();
    expect(screen.queryByLabelText('Search chores')).toBeNull();
  });
});
