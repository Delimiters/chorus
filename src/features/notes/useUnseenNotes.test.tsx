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
let mockLoading = false;
let mockError: Error | null = null;

jest.mock('@/data/hooks/useNotes', () => ({
  useNotes: () => ({
    data: mockRows,
    isLoading: mockLoading,
    error: mockError,
    refetch: jest.fn(),
  }),
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
    mockLoading = false;
    mockError = null;
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
   * A phone that has never seen the board starts from the newest note on it,
   * not from what the phone thinks the time is. Everything already there
   * predates the install and none of it is news.
   */
  it('seeds itself from the newest note, so a fresh install shows nothing', () => {
    mockRows = [THEIR_NOTE];
    seenAt(null);

    render(<Badge />);

    expect(screen.getByText(/badge:/).children.join('')).toBe('badge:none');
    expect(useNoteSeenStore.getState().lastSeenAt).toBe(THEIR_NOTE.updatedAt);
  });

  /*
   * The first-run path, which the seed used to no-op on.
   *
   * A brand-new household has an empty board — the common first-run state —
   * and seeding only when there was something to seed from left `lastSeenAt`
   * null forever. The first note ever written then went unbadged: the render
   * that saw it still had null (count zero), and the effect seeded straight to
   * that note's own stamp, marking it seen without ever showing it. Every note
   * after it badged, which is exactly the bug nobody reports.
   */
  it('badges the very first note written to a board that started empty', () => {
    mockRows = [];
    seenAt(null);

    const view = render(<Badge />);
    expect(screen.getByText(/badge:/).children.join('')).toBe('badge:none');

    // The housemate writes the first note while you are on another tab.
    mockRows = [THEIR_NOTE];
    view.rerender(<Badge />);

    expect(screen.getByText(/badge:/).children.join('')).toBe('badge:1');
  });

  it('does not seed an empty board that has not finished loading', () => {
    mockRows = [];
    mockLoading = true;
    seenAt(null);

    render(<Badge />);

    expect(useNoteSeenStore.getState().lastSeenAt).toBeNull();
  });

  /*
   * The clock-skew case, which is why "seen" is a stamp copied off a note
   * rather than a reading of `Date.now()`.
   *
   * Here the phone is nowhere near the server's time — it thinks it is 2020.
   * Marking device time would have left a badge on a board being looked at
   * until the phone caught up. Marking the note's own stamp cannot.
   */
  it('clears against a phone whose clock is wrong', () => {
    jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2020-01-01T00:00:00.000Z');
    mockRows = [THEIR_NOTE];
    seenAt('2026-09-30T11:00:00.000Z');

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
    jest.restoreAllMocks();
  });

  /*
   * An errored board is not an empty one. Clearing the badge for notes whose
   * fetch failed loses them, and `markSeen` only moves forward.
   */
  it('does not clear when the board failed to load', () => {
    mockRows = [THEIR_NOTE];
    seenAt('2026-09-30T11:00:00.000Z');
    mockError = new Error('offline');

    render(
      <ThemeProvider>
        <NotesScreen />
      </ThemeProvider>,
    );
    screen.unmount();

    mockError = null;
    render(
      <ThemeProvider>
        <Badge />
      </ThemeProvider>,
    );
    expect(screen.getByText(/badge:/).children.join('')).toBe('badge:1');
  });

  it('does not clear while the board is still loading', () => {
    mockRows = [THEIR_NOTE];
    seenAt('2026-09-30T11:00:00.000Z');
    mockLoading = true;

    render(
      <ThemeProvider>
        <NotesScreen />
      </ThemeProvider>,
    );

    expect(useNoteSeenStore.getState().lastSeenAt).toBe('2026-09-30T11:00:00.000Z');
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
