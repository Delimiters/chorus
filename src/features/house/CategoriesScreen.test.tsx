/**
 * Editing a category, which used to look like a broken button.
 *
 * The editor was an inline block pinned below the list, so pressing "Edit" on a
 * row filled in a form that was off-screen whenever there were more categories
 * than fit. Jake: *"the categories tab no longer lets me edit a category. The
 * button just does nothing."* It did something; there was no way to tell.
 *
 * This file did not exist before — the screen had no tests at all, which is why
 * a control that appeared to do nothing could ship.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '@/design/theme';
import { CategoriesScreen } from './CategoriesScreen';

const mockPush = jest.fn();

type Row = { id: string; name: string; ink: string | null; icon: string | null };

let mockCategories: Row[] = [];
let mockQuery: { data: Row[]; isPending: boolean; isError: boolean; error: Error | null };

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
}));

/*
 * `isPending` / `isError`, which is what the screen reads. The first version of
 * this mock returned `{ isLoading, error }` — the wrong shape — and passed only
 * because `undefined` is falsy, so the loading and error guards were never
 * exercised and would have gone on not being exercised silently.
 */
jest.mock('@/data/hooks/useCategories', () => ({
  useCategories: () => mockQuery,
  useCreateCategory: () => ({ mutate: jest.fn(), isPending: false, error: null }),
  useUpdateCategory: () => ({ mutate: jest.fn(), isPending: false, error: null }),
  useDeleteCategory: () => ({ mutate: jest.fn(), error: null }),
  useReorderCategories: () => ({ mutate: jest.fn(), error: null }),
}));

const renderScreen = () =>
  render(
    <ThemeProvider>
      <CategoriesScreen />
    </ThemeProvider>,
  );

beforeEach(() => {
  mockPush.mockClear();
  mockCategories = [
    { id: 'kitchen', name: 'Kitchen', ink: 'blue', icon: null },
    { id: 'garden', name: 'Garden', ink: 'green', icon: null },
  ];
  mockQuery = { data: mockCategories, isPending: false, isError: false, error: null };
});

describe('while the categories are not there', () => {
  it('waits rather than showing an empty list', () => {
    mockQuery = { data: [], isPending: true, isError: false, error: null };
    renderScreen();

    expect(screen.getByText('Loading categories')).toBeOnTheScreen();
    expect(screen.queryByText('Kitchen')).toBeNull();
  });

  it('says what went wrong rather than showing nothing', () => {
    mockQuery = {
      data: [],
      isPending: false,
      isError: true,
      error: new Error('The house could not be reached.'),
    };
    renderScreen();

    expect(screen.getByText('The house could not be reached.')).toBeOnTheScreen();
  });
});

describe('editing a category', () => {
  it('opens its own screen rather than revealing a form below the list', () => {
    renderScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Edit Kitchen' }));

    expect(mockPush).toHaveBeenCalledWith('/category/kitchen');
  });

  it('does not keep an editor inline', () => {
    /*
     * The form being below the fold is the whole defect, so its absence from
     * the list screen is the thing to assert — a "Name" field here means it is
     * back.
     */
    renderScreen();

    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByText('Rename category')).toBeNull();
  });
});

describe('adding a category', () => {
  it('also opens a screen', () => {
    renderScreen();

    fireEvent.press(screen.getByRole('button', { name: 'New category' }));

    expect(mockPush).toHaveBeenCalledWith('/category/new');
  });
});
