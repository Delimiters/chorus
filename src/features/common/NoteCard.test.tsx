import { fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '@/design/theme';

import { NoteCard } from './NoteCard';

const NOW = new Date().toISOString();

const renderCard = (over: Partial<React.ComponentProps<typeof NoteCard>> = {}) =>
  render(
    <ThemeProvider>
      <NoteCard
        title="Boiler"
        body="Landlord said he would send someone."
        editorName="Emily"
        editorInk="#ff0000"
        updatedAt={NOW}
        onPress={() => {}}
        {...over}
      />
    </ThemeProvider>,
  );

describe('a note on the board', () => {
  it('leads with its title and previews the body', () => {
    renderCard();

    expect(screen.getByText('Boiler')).toBeOnTheScreen();
    expect(screen.getByText(/Landlord said he would send someone/)).toBeOnTheScreen();
  });

  it('says who touched it last and when', () => {
    // The footer is the whole of this feature's answer to two people typing at
    // once, so it is not decoration.
    renderCard();

    expect(screen.getByText(/Emily · just now/)).toBeOnTheScreen();
  });

  it('promotes the first line when there is no title', () => {
    /*
     * People paste a sentence and leave. Without this the card is top-empty,
     * which on a stack of cards reads as a broken row.
     */
    renderCard({ title: null, body: 'Ask about the boiler\nand the gutters' });

    expect(screen.getByText('Ask about the boiler')).toBeOnTheScreen();
  });

  it('does not print the promoted line twice', () => {
    // The obvious implementation shows the first line as the heading *and* at
    // the top of the preview.
    renderCard({ title: null, body: 'Ask about the boiler\nand the gutters' });

    expect(screen.queryAllByText(/Ask about the boiler/)).toHaveLength(1);
    expect(screen.getByText('and the gutters')).toBeOnTheScreen();
  });

  it('clips the preview rather than growing to fit', () => {
    // A card that grows to its content turns the board into a wall of text,
    // which is the failure this app has hit on every other list.
    renderCard({ body: 'x\n'.repeat(40) });

    expect(screen.getByText(/x/).props.numberOfLines).toBe(2);
  });

  it('says so when a note is empty rather than rendering a blank card', () => {
    renderCard({ title: null, body: '   ' });

    expect(screen.getByText('Empty note')).toBeOnTheScreen();
  });

  it('opens when tapped', () => {
    const onPress = jest.fn();
    renderCard({ onPress });

    fireEvent.press(screen.getByLabelText('Boiler'));

    expect(onPress).toHaveBeenCalled();
  });
});
