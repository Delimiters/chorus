/**
 * Saving a chore, and the two ways it used to go wrong quietly.
 *
 * Written after a review found both of this screen's bug fixes shipped with no
 * coverage of any kind — there was no test file for `ChoreEditor` at all, so
 * reverting either fix left the whole suite green.
 *
 * What they protect:
 *
 *  - `saveSteps` had `onError: close` beside `onSuccess: close`, and its error
 *    was in neither the pending nor the failure state. A failed step write
 *    dismissed the form exactly as a success did and said nothing.
 *  - On a new chore, `create` resolving re-enabled Save while the steps were
 *    still writing. A second tap saw the route's `chore` still undefined and
 *    created a *second* chore.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '@/design/theme';

import { ChoreEditor } from './ChoreEditor';

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockSaveSteps = jest.fn();
let mockSaveStepsError: Error | null = null;
let mockSaveStepsPending = false;
let mockChore: { id: string; title: string; archived: boolean } | undefined;

jest.mock('@/data/hooks/useChores', () => ({
  useChore: () => mockChore,
  useCreateChore: () => ({ mutate: mockCreate, isPending: false, error: null }),
  useUpdateChore: () => ({ mutate: mockUpdate, isPending: false, error: null }),
  useArchiveChore: () => ({ mutate: jest.fn(), isPending: false, error: null }),
}));
jest.mock('@/data/hooks/useSubtasks', () => ({
  useSubtasksFor: () => [],
  useReplaceSubtasks: () => ({
    mutate: mockSaveSteps,
    isPending: mockSaveStepsPending,
    error: mockSaveStepsError,
  }),
}));
jest.mock('@/data/hooks/useHousehold', () => ({
  useHousehold: () => ({ data: { timeZone: 'UTC', weekStartsOn: 0 } }),
  useMembers: () => ({ data: [{ userId: 'me', displayName: 'Jake', accent: 'blue' }] }),
}));
jest.mock('@/data/today', () => ({ useToday: () => '2026-09-29' }));
jest.mock('@/stores/sessionStore', () => ({
  useUserId: () => 'me',
  useActiveHouseholdId: () => 'house-1',
}));
// The form reaches for categories and icons of its own; neither is what these
// tests are about, and both want a QueryClient this harness has no reason to
// build.
jest.mock('@/data/hooks/useCategories', () => ({
  useCategories: () => ({ data: [] }),
  useCategoryList: () => [],
  useCreateCategory: () => ({ mutate: jest.fn(), isPending: false, error: null }),
}));
jest.mock('@/stores/routineStore', () => ({
  useRoutineStore: (selector: (s: unknown) => unknown) =>
    selector({ queuePlanOnCreate: jest.fn() }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({}),
}));

const renderEditor = () =>
  render(
    <ThemeProvider>
      <ChoreEditor choreId={null} />
    </ThemeProvider>,
  );

const typeTitle = (title: string) => {
  fireEvent.changeText(screen.getByLabelText('Name'), title);
};

beforeEach(() => {
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockSaveSteps.mockReset();
  mockSaveStepsError = null;
  mockSaveStepsPending = false;
  mockChore = undefined;
});

describe('when saving the steps fails', () => {
  it('says so instead of closing as though it worked', async () => {
    /*
     * `replaceSubtasks` is a read, a delete and one round trip per step with
     * no transaction, so it can fail outright or half-way. Closing on failure
     * lost the error and, sometimes, half the steps.
     */
    mockSaveStepsError = new Error('Network request failed');
    renderEditor();

    expect(await screen.findByText(/Network request failed/)).toBeOnTheScreen();
  });

  it('does not close the form on the failure path', () => {
    renderEditor();
    typeTitle('Dishes');
    fireEvent.press(screen.getByText('Add chore'));

    // The chore write is what runs first; the steps follow in its `onSuccess`.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const options = mockCreate.mock.calls[0]?.[1] as { onSuccess: (id: string) => void };
    act(() => options.onSuccess('chore-1'));

    expect(mockSaveSteps).toHaveBeenCalledTimes(1);
    // Only `onSuccess` closes. `onError: close` used to sit beside it.
    const stepOptions = mockSaveSteps.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(stepOptions.onSuccess).toEqual(expect.any(Function));
    expect(stepOptions.onError).toBeUndefined();
  });
});

describe('tapping Save twice on a new chore', () => {
  it('updates the chore it just made rather than making another', () => {
    /*
     * The duplicate. `create` resolves, the button re-enables while the steps
     * are still writing, and the second tap saw the route's `chore` still
     * undefined — so it created a second chore. Jake reported the same shape
     * from the phone once before, on the plan.
     */
    renderEditor();
    typeTitle('Dishes');
    fireEvent.press(screen.getByText('Add chore'));

    // Inside `act`, or the `setCreatedId` it performs has not flushed before
    // the second tap reads it — and the test would fail against a correct fix.
    const options = mockCreate.mock.calls[0]?.[1] as { onSuccess: (id: string) => void };
    act(() => options.onSuccess('chore-1'));

    fireEvent.press(screen.getByText('Add chore'));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ choreId: 'chore-1' }),
      expect.anything(),
    );
  });

  it('will not accept a second tap while the steps are still writing', () => {
    // The other half: `saveSteps.isPending` now counts as saving, so the
    // button is disabled for the whole write rather than just the first half.
    mockSaveStepsPending = true;
    renderEditor();
    typeTitle('Dishes');
    fireEvent.press(screen.getByText('Add chore'));

    expect(mockCreate).not.toHaveBeenCalled();
  });
});
