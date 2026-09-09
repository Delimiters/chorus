/**
 * The category editor screen.
 *
 * A review found this had no tests at all — the route that *reaches* it was
 * covered (CategoriesScreen.test.tsx) and the screen itself was not, which is
 * the shape of the defect AGENTS.md records under "a defect can be invisible to
 * every test": for four phases nobody could join a household, because the invite
 * API existed, was tested, and had no screen.
 *
 * The seeding is the part worth pinning. It fills the fields once from the
 * loaded category and then deliberately stops tracking it, because re-seeding
 * on every render would discard whatever is being typed the moment a refetch
 * lands — and refetches are frequent here, since every category mutation
 * invalidates the whole household prefix.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '@/design/theme';
import { CategoryEditor } from './CategoryEditor';

type Row = { id: string; name: string; ink: string | null; icon: string | null };

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();

let mockQuery: { data: Row[]; isLoading: boolean; isPending: boolean };
let mockCanGoBack = true;

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => mockCanGoBack,
  }),
}));

jest.mock('@/data/hooks/useCategories', () => ({
  useCategories: () => mockQuery,
  useCreateCategory: () => ({ mutate: mockCreate, isPending: false, error: null }),
  useUpdateCategory: () => ({ mutate: mockUpdate, isPending: false, error: null }),
}));

const renderEditor = (categoryId: string | null) =>
  render(
    <ThemeProvider>
      <CategoryEditor categoryId={categoryId} />
    </ThemeProvider>,
  );

beforeEach(() => {
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockBack.mockReset();
  mockReplace.mockReset();
  mockCanGoBack = true;
  mockQuery = {
    data: [{ id: 'kitchen', name: 'Kitchen', ink: 'blue', icon: null }],
    isLoading: false,
    isPending: false,
  };
});

describe('editing an existing category', () => {
  it('opens with the category already in the fields', () => {
    renderEditor('kitchen');
    expect(screen.getByDisplayValue('Kitchen')).toBeOnTheScreen();
  });

  it('says which category it is, which the inline form could not', () => {
    renderEditor('kitchen');
    expect(screen.getByRole('header', { name: 'Edit category' })).toBeOnTheScreen();
  });

  it('saves the edited name against the same id', () => {
    renderEditor('kitchen');
    fireEvent.changeText(screen.getByLabelText('Name'), 'Kitchen & pantry');
    fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: 'kitchen', name: 'Kitchen & pantry' }),
      expect.anything(),
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('does not overwrite what is being typed when the query refetches', async () => {
    /*
     * The reason the seed is one-shot. Every category mutation invalidates the
     * whole household prefix, so a refetch landing mid-edit is ordinary — and
     * a component that re-seeded from `data` would silently revert the field.
     */
    const view = renderEditor('kitchen');
    fireEvent.changeText(screen.getByLabelText('Name'), 'Half-typed nam');

    mockQuery = { ...mockQuery, data: [...mockQuery.data] };
    view.rerender(
      <ThemeProvider>
        <CategoryEditor categoryId="kitchen" />
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByDisplayValue('Half-typed nam')).toBeOnTheScreen());
  });

  it('refuses to save an empty name rather than saving a blank category', () => {
    renderEditor('kitchen');
    fireEvent.changeText(screen.getByLabelText('Name'), '   ');
    fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('waits rather than showing an empty form for a category still loading', () => {
    /*
     * An empty form here looks exactly like "new category", and saving it would
     * create a duplicate instead of editing the one that was asked for.
     *
     * The assertion is that it says *loading* rather than that it hides the
     * button: both this branch and the not-found branch below hide the button,
     * so a test that only checked for its absence passed with the loading guard
     * deleted entirely. It did, until this line was written.
     */
    mockQuery = { data: [], isLoading: true, isPending: true };
    renderEditor('kitchen');

    expect(screen.getByText('Loading the category')).toBeOnTheScreen();
    expect(screen.queryByText('That category no longer exists.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });

  it('waits while the household itself is still unknown', () => {
    // A `skipToken`-disabled query reports `isLoading: false` and `isPending:
    // true`. Reading the first is how this screen used to tell a signed-in user
    // their category had been deleted, a moment after they opened it.
    mockQuery = { data: [], isLoading: false, isPending: true };
    renderEditor('kitchen');

    expect(screen.getByText('Loading the category')).toBeOnTheScreen();
    expect(screen.queryByText('That category no longer exists.')).toBeNull();
  });

  it('says so when the category is gone', () => {
    mockQuery = { data: [], isLoading: false, isPending: false };
    renderEditor('gone');

    expect(screen.getByText('That category no longer exists.')).toBeOnTheScreen();
  });
});

describe('creating a category', () => {
  it('opens empty and titled for a new one', () => {
    renderEditor(null);
    expect(screen.getByRole('header', { name: 'New category' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Name').props.value).toBe('');
  });

  it('creates rather than updating', () => {
    renderEditor(null);
    fireEvent.changeText(screen.getByLabelText('Name'), 'Garage');
    fireEvent.press(screen.getByRole('button', { name: 'Add category' }));

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Garage' }),
      expect.anything(),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('leaving', () => {
  it('goes back when there is somewhere to go back to', () => {
    renderEditor('kitchen');
    fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockBack).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('lands on the list when opened cold from a link', () => {
    // Deep-linked straight to /category/kitchen: `back()` would leave the app.
    mockCanGoBack = false;
    renderEditor('kitchen');
    fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockReplace).toHaveBeenCalledWith('/categories');
  });
});
