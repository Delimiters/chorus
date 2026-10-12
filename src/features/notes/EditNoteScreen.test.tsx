/**
 * The note editor's three states, none of which had a test.
 *
 * A review found the error case fell through to "That note is gone" — a
 * confident and wrong answer to a dropped connection — and that both screens
 * called a bare `router.back()`, which does nothing on a cold start.
 */
import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';

import { NOTE_BODY_MAX, NOTE_TITLE_MAX } from '@/core/text/limits';

import { ThemeProvider } from '@/design/theme';

import { EditNoteScreen } from './EditNoteScreen';

const NOW = new Date().toISOString();

let mockNotes: {
  data:
    | {
        id: string;
        title: string | null;
        body: string;
        createdBy: string | null;
        updatedBy: string | null;
        updatedAt: string;
      }[]
    | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
};
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;

jest.mock('@/data/hooks/useNotes', () => ({
  useNotes: () => mockNotes,
  useUpdateNote: () => ({ mutate: mockUpdate, isPending: false, error: null }),
  useDeleteNote: () => ({ mutate: mockDelete, isPending: false, error: null }),
}));
jest.mock('@/data/hooks/useHousehold', () => ({
  useMembers: () => ({ data: [{ userId: 'them', displayName: 'Emily', accent: 'pink' }] }),
}));
jest.mock('@/stores/sessionStore', () => ({ useUserId: () => 'me' }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: () => mockCanGoBack }),
  useLocalSearchParams: () => ({ id: 'n1' }),
}));

const renderScreen = () =>
  render(
    <ThemeProvider>
      <EditNoteScreen />
    </ThemeProvider>,
  );

beforeEach(() => {
  mockNotes = {
    data: [
      {
        id: 'n1',
        title: 'Boiler',
        body: 'Chase the landlord.',
        createdBy: 'me',
        updatedBy: 'them',
        updatedAt: NOW,
      },
    ],
    isLoading: false,
    error: null,
    refetch: () => {},
  };
  mockCanGoBack = true;
  mockUpdate.mockClear();
  mockDelete.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
});

describe('opening a note', () => {
  /*
   * Reading, not editing. Jake: *"I should be able to open it and still just
   * view, so it's easy to click links and whatnot, and then have an edit button
   * to actually change the text."* Opening into a `TextInput` made the links
   * untappable, because the field swallows the tap — so the most useful thing
   * in a note was the one thing you could not use.
   */
  const edit = () => fireEvent.press(screen.getByText('Edit'));

  it('shows the note as text, not as a field', () => {
    renderScreen();

    expect(screen.getByText('Chase the landlord.')).toBeOnTheScreen();
    expect(screen.getByText('Boiler')).toBeOnTheScreen();
    expect(screen.queryByDisplayValue('Chase the landlord.')).toBeNull();
  });

  it('says who touched it last', () => {
    renderScreen();

    expect(screen.getByText(/Emily/)).toBeOnTheScreen();
  });

  it('opens the editor when you ask for it', () => {
    renderScreen();
    edit();

    expect(screen.getByDisplayValue('Chase the landlord.')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('Boiler')).toBeOnTheScreen();
  });

  it('saves the edit', () => {
    renderScreen();
    edit();

    fireEvent.changeText(
      screen.getByDisplayValue('Chase the landlord.'),
      'Chased. He is sending someone.',
    );
    fireEvent.press(screen.getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'n1', body: 'Chased. He is sending someone.' }),
      expect.anything(),
    );
  });

  it('goes back to reading when you back out of editing, not to the board', () => {
    /*
     * Somebody who opened a note to read it, tapped Edit and changed their mind
     * wants the note — not the list. Popping the screen would be two taps to
     * get back to what they were looking at.
     */
    renderScreen();
    edit();
    fireEvent.press(screen.getByRole('button', { name: 'Back to note' }));

    expect(screen.getByText('Chase the landlord.')).toBeOnTheScreen();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('draws a bulleted note as a list', () => {
    mockNotes = {
      ...mockNotes,
      data: [{ ...mockNotes.data![0]!, body: '- milk\n- eggs' }],
    };
    renderScreen();

    // The markers, and the items as their own text rather than one blob.
    expect(screen.getAllByText('•')).toHaveLength(2);
    expect(screen.getByText('milk')).toBeOnTheScreen();
    expect(screen.getByText('eggs')).toBeOnTheScreen();
  });

  it('draws a numbered note with its numbers', () => {
    mockNotes = {
      ...mockNotes,
      data: [{ ...mockNotes.data![0]!, body: '1. pharmacy\n1. vet' }],
    };
    renderScreen();

    // Renumbered on render, so a list typed "1. 1." reads 1, 2.
    expect(screen.getByText('1.')).toBeOnTheScreen();
    expect(screen.getByText('2.')).toBeOnTheScreen();
  });

  it('makes a link in the note tappable', () => {
    mockNotes = {
      ...mockNotes,
      data: [{ ...mockNotes.data![0]!, body: 'order from https://example.com/part' }],
    };
    renderScreen();

    expect(screen.getByRole('link', { name: 'https://example.com/part' })).toBeOnTheScreen();
  });

  it('says so when the note is empty rather than drawing nothing', () => {
    mockNotes = { ...mockNotes, data: [{ ...mockNotes.data![0]!, body: '   ' }] };
    renderScreen();

    expect(screen.getByText('This note is empty.')).toBeOnTheScreen();
  });
});

describe('the list buttons in the editor', () => {
  it('turn the current line into a bullet', () => {
    renderScreen();
    fireEvent.press(screen.getByText('Edit'));

    const field = screen.getByDisplayValue('Chase the landlord.');
    fireEvent(field, 'selectionChange', { nativeEvent: { selection: { start: 5, end: 5 } } });
    fireEvent.press(screen.getByText('• Bullet'));

    expect(screen.getByDisplayValue('- Chase the landlord.')).toBeOnTheScreen();
  });

  it('turn it into a numbered item', () => {
    renderScreen();
    fireEvent.press(screen.getByText('Edit'));

    const field = screen.getByDisplayValue('Chase the landlord.');
    fireEvent(field, 'selectionChange', { nativeEvent: { selection: { start: 0, end: 0 } } });
    fireEvent.press(screen.getByText('1. Numbered'));

    expect(screen.getByDisplayValue('1. Chase the landlord.')).toBeOnTheScreen();
  });

  it('take the marker off again', () => {
    renderScreen();
    fireEvent.press(screen.getByText('Edit'));

    const field = screen.getByDisplayValue('Chase the landlord.');
    fireEvent(field, 'selectionChange', { nativeEvent: { selection: { start: 0, end: 0 } } });
    fireEvent.press(screen.getByText('• Bullet'));
    fireEvent.press(screen.getByText('• Bullet'));

    expect(screen.getByDisplayValue('Chase the landlord.')).toBeOnTheScreen();
  });
});

describe('when something goes wrong', () => {
  it('says a fetch failed, rather than claiming the note was deleted', () => {
    /*
     * The failure mode: `data` is undefined on error too, so the "gone" branch
     * below caught a dropped connection and told you somebody had deleted your
     * note.
     */
    mockNotes = {
      data: undefined,
      isLoading: false,
      error: new Error('Network request failed'),
      refetch: () => {},
    };
    renderScreen();

    expect(screen.getByText(/Network request failed/)).toBeOnTheScreen();
    expect(screen.queryByText('That note is gone.')).toBeNull();
  });

  it('says plainly when the note really is gone, without apologising', () => {
    // Deleted on the other phone is ordinary on a shared board. `ErrorState`
    // would head this "Something went wrong" and offer "Try again".
    mockNotes = { data: [], isLoading: false, error: null, refetch: () => {} };
    renderScreen();

    expect(screen.getByText('That note is gone.')).toBeOnTheScreen();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('offers a way out of the gone state on a cold start', () => {
    /*
     * With no history — a deep link, or a notification tap once those exist —
     * `back()` does nothing at all, so this screen was a dead end with no
     * back bar of its own.
     */
    mockNotes = { data: [], isLoading: false, error: null, refetch: () => {} };
    mockCanGoBack = false;
    renderScreen();

    fireEvent.press(screen.getByText('Back to the notes'));

    expect(mockReplace).toHaveBeenCalledWith('/notes');
  });
});

describe('deleting', () => {
  /*
   * Delete lives in the editor, which is now a deliberate tap away — reading a
   * note should not put a destructive button under your thumb.
   */
  const openEditor = () => {
    renderScreen();
    fireEvent.press(screen.getByText('Edit'));
  };

  it('asks first, because a note has no undo', () => {
    openEditor();

    fireEvent.press(screen.getByText('Delete'));
    expect(screen.getByText(/This deletes it for both of you/)).toBeOnTheScreen();
    expect(mockDelete).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('Delete it'));
    expect(mockDelete).toHaveBeenCalledWith('n1', expect.anything());
  });

  it('lets you back out', () => {
    openEditor();

    fireEvent.press(screen.getByText('Delete'));
    fireEvent.press(screen.getByText('Keep it'));

    expect(screen.queryByText('Delete it')).toBeNull();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe('how much a note can hold', () => {
  /*
   * Typed rather than asserted as props. `fireEvent.changeText` sets a value
   * directly and bypasses `maxLength`; `userEvent.type` maintains text state and
   * enforces it, so the cap is observable as behaviour — a prop assertion would
   * pass against a component that ignored the prop.
   *
   * A `maxLength` below the CHECK is the invisible failure: nothing errors, you
   * simply cannot type the heading you wanted.
   */
  it('takes a heading as long as every other title', async () => {
    renderScreen();
    fireEvent.press(screen.getByText('Edit'));
    const title = screen.getByLabelText('Title');

    await userEvent.type(title, 'a'.repeat(NOTE_TITLE_MAX + 10));

    expect((title.props.value as string).length).toBe(NOTE_TITLE_MAX);
    // `userEvent.type` costs an event per character, so the budget has to scale
    // with the cap rather than sit at the 5000ms default.
  }, 20000);

  it('takes a body far longer, which is what a note is', () => {
    /*
     * The prop here, deliberately: typing 20,001 characters one keystroke at a
     * time takes minutes. The heading above proves the mechanism works; this
     * guards the pair against drifting apart.
     */
    renderScreen();
    fireEvent.press(screen.getByText('Edit'));

    expect(screen.getByLabelText('Note').props.maxLength).toBe(NOTE_BODY_MAX);
    expect(NOTE_TITLE_MAX).toBeLessThan(NOTE_BODY_MAX);
  });
});

describe('a note pasted from another app', () => {
  /*
   * Emily's real note is a checklist pasted from one app and an outline pasted
   * from another. These are the shapes that actually arrived, which is why they
   * are here rather than in a sketch.
   */
  const withBody = (body: string) => {
    mockNotes = { ...mockNotes, data: [{ ...mockNotes.data![0]!, body }] };
    renderScreen();
  };

  it('draws a pasted checklist as boxes, not as brackets', () => {
    withBody('- [ ] wash blankets\n- [x] hand towels');

    expect(screen.getByText('☐')).toBeOnTheScreen();
    expect(screen.getByText('☑')).toBeOnTheScreen();
    expect(screen.getByText('wash blankets')).toBeOnTheScreen();
    // The syntax it understood is not shown back to her.
    expect(screen.queryByText(/\[ \]/)).toBeNull();
  });

  it('draws iOS Notes’ own boxes the same way', () => {
    withBody('☐ wash blankets\n☑ hand towels');

    expect(screen.getByText('☐')).toBeOnTheScreen();
    expect(screen.getByText('☑')).toBeOnTheScreen();
  });

  it('keeps a pasted outline’s levels, with a different dot each', () => {
    withBody('\t• Update Chorus\n\t\t○ Bills:\n\t\t\t§ Utility bill');

    expect(screen.getByText('Update Chorus')).toBeOnTheScreen();
    expect(screen.getByText('Bills:')).toBeOnTheScreen();
    expect(screen.getByText('Utility bill')).toBeOnTheScreen();
    // Level one, two and three draw differently, so the shape reads at a glance.
    expect(screen.getByText('◦')).toBeOnTheScreen();
    expect(screen.getByText('▪')).toBeOnTheScreen();
  });

  it('still makes a link tappable inside a checklist item', () => {
    withBody('- [ ] Sensory deprivation:https://share.google/isCqATEO9A4VX1QTk');

    expect(
      screen.getByRole('link', { name: 'https://share.google/isCqATEO9A4VX1QTk' }),
    ).toBeOnTheScreen();
  });

  it('leaves the stored text exactly as it was when you open it to edit', () => {
    /*
     * The guarantee that matters for somebody else's note: formatting happens
     * on the way to the screen, never on the way to the database. Opening the
     * editor shows what she typed, character for character.
     */
    const original = '☐ wash blankets\n\t• Update Chorus';
    withBody(original);
    fireEvent.press(screen.getByText('Edit'));

    expect(screen.getByDisplayValue(original)).toBeOnTheScreen();
  });
});
