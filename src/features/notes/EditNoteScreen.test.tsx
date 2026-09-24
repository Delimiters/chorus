/**
 * The note editor's three states, none of which had a test.
 *
 * A review found the error case fell through to "That note is gone" — a
 * confident and wrong answer to a dropped connection — and that both screens
 * called a bare `router.back()`, which does nothing on a cold start.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

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
  it('shows what is in it, and who touched it last', () => {
    renderScreen();

    expect(screen.getByDisplayValue('Boiler')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('Chase the landlord.')).toBeOnTheScreen();
    expect(screen.getByText(/Emily edited this just now/)).toBeOnTheScreen();
  });

  it('saves the edit', () => {
    renderScreen();

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
  it('asks first, because a note has no undo', () => {
    renderScreen();

    fireEvent.press(screen.getByText('Delete'));
    expect(screen.getByText(/This deletes it for both of you/)).toBeOnTheScreen();
    expect(mockDelete).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('Delete it'));
    expect(mockDelete).toHaveBeenCalledWith('n1', expect.anything());
  });

  it('lets you back out', () => {
    renderScreen();

    fireEvent.press(screen.getByText('Delete'));
    fireEvent.press(screen.getByText('Keep it'));

    expect(screen.queryByText('Delete it')).toBeNull();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
