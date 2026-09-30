/**
 * The badge, tested where it is wired rather than where it is computed.
 *
 * `countUnseenNotes` has its own unit tests and they would pass with nothing
 * connected to them — the archetype defect in this project is a correct pure
 * function that no screen reaches. So these render the real board against the
 * real store and assert the badge a real tab bar would show.
 */
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ThemeProvider } from '@/design/theme';
import { useNoteSeenStore } from '@/stores/noteSeenStore';

import { NotesScreen } from './NotesScreen';
import { useNoteBadge } from './useUnseenNotes';

interface Row {
  id: string;
  title: string | null;
  body: string;
  createdBy: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

let mockRows: Row[] = [];

jest.mock('@/data/hooks/useNotes', () => ({
  useNotes: () => ({ data: mockRows, isLoading: false, error: null, refetch: jest.fn() }),
  useNoteList: () => mockRows,
}));
jest.mock('@/data/hooks/useHousehold', () => ({
  useMembers: () => ({ data: [{ userId: 'them', displayName: 'Emily', accent: 'pink' }] }),
}));
jest.mock('@/stores/sessionStore', () => ({ useUserId: () => 'me' }));

/*
 * `useFocusEffect` really does run its effect on mount in expo-router, so the
 * mock must too — a stub that ignored it would make the clearing test pass
 * against a board that never marked anything seen.
 *
 * `mockFocuses` turns it off, which is the only way to reach the state a tab
 * bar spends most of its time in: the board mounted, and some other tab in
 * front of it.
 */
let mockFocuses = true;

jest.mock('expo-router', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true }),
    useFocusEffect: (effect: () => void | (() => void)) => {
      react.useEffect(() => {
        if (!mockFocuses) return;
        return effect();
      }, [effect]);
    },
  };
});

function Badge() {
  const badge = useNoteBadge();
  return <Text>badge:{badge ?? 'none'}</Text>;
}

const THEIR_NOTE: Row = {
  id: 'n1',
  title: 'Boiler',
  body: 'Landlord is sending someone.',
  createdBy: 'them',
  updatedBy: 'them',
  updatedAt: '2026-09-30T12:00:00.000Z',
};

function seenAt(at: string | null): void {
  useNoteSeenStore.setState({ lastSeenAt: at, hydrated: true });
}

describe('the Notes tab badge', () => {
  beforeEach(() => {
    mockRows = [];
    mockFocuses = true;
    seenAt(null);
  });

  it('shows a count for a note the housemate wrote since you last looked', () => {
    mockRows = [THEIR_NOTE];
    seenAt('2026-09-30T11:00:00.000Z');

    render(<Badge />);

    expect(screen.getByText(/badge:/).children.join('')).toBe('badge:1');
  });

  it('shows nothing when the only note is your own', () => {
    mockRows = [{ ...THEIR_NOTE, updatedBy: 'me' }];
    seenAt('2026-09-30T11:00:00.000Z');

    render(<Badge />);

    expect(screen.getByText(/badge:/).children.join('')).toBe('badge:none');
  });

  /*
   * The wiring test. Opening the board must move the stored moment past the
   * note — through the real screen, the real `useFocusEffect` and the real
   * store. Deleting `useFocusEffect(markSeen)` from NotesScreen fails only
   * this one.
   */
  it('clears once the board has been opened', () => {
    mockRows = [THEIR_NOTE];
    seenAt('2026-09-30T11:00:00.000Z');

    render(
      <ThemeProvider>
        <Badge />
      </ThemeProvider>,
    );
    expect(screen.getByText(/badge:/).children.join('')).toBe('badge:1');
    screen.unmount();

    render(
      <ThemeProvider>
        <NotesScreen />
      </ThemeProvider>,
    );
    screen.unmount();

    render(
      <ThemeProvider>
        <Badge />
      </ThemeProvider>,
    );
    expect(screen.getByText(/badge:/).children.join('')).toBe('badge:none');
  });

  /*
   * The defect the first version shipped. A tab screen stays mounted after you
   * navigate away, so an effect keyed on the note list alone marked the board
   * seen the moment a note arrived — clearing a badge that had never been
   * shown. Here the board is mounted and unfocused, exactly as it is while you
   * read Today.
   */
  it('still badges a note that arrives while you are on another tab', () => {
    seenAt('2026-09-30T11:00:00.000Z');
    mockFocuses = false;

    // The board is mounted, as a tab screen you have already visited is.
    const board = render(
      <ThemeProvider>
        <NotesScreen />
      </ThemeProvider>,
    );

    // Its list updates over realtime while you are elsewhere.
    mockRows = [THEIR_NOTE];
    board.rerender(
      <ThemeProvider>
        <NotesScreen />
      </ThemeProvider>,
    );
    board.unmount();

    render(
      <ThemeProvider>
        <Badge />
      </ThemeProvider>,
    );
    expect(screen.getByText(/badge:/).children.join('')).toBe('badge:1');
  });

  /*
   * And the guard on the other side of that: the board must not mark anything
   * seen before the stored moment has been read off disk, or the seed written
   * by `hydrate` would overwrite it and un-see every note.
   */
  it('does not mark anything seen before the store has hydrated', () => {
    mockRows = [THEIR_NOTE];
    useNoteSeenStore.setState({ lastSeenAt: null, hydrated: false });

    render(
      <ThemeProvider>
        <NotesScreen />
      </ThemeProvider>,
    );

    expect(useNoteSeenStore.getState().lastSeenAt).toBeNull();
  });
});
