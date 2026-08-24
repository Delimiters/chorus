/**
 * The chore library, and specifically what it does with things already done.
 *
 * There was no test for this screen at all, which is how a completed one-time
 * chore came to sit in the active list at full opacity for ever. Nothing was
 * wrong with any function it calls: completion lives in `chore_completions`,
 * the screen only ever asked about Someday chores, and so a finished one-time
 * chore was indistinguishable from an outstanding one.
 */

import { render, screen } from '@testing-library/react-native';

import { civilDate } from '@/core/civil/date';
import type { Chore } from '@/data/api/chores';
import { ThemeProvider } from '@/design/theme';
import { ChoresScreen } from './ChoresScreen';

const TODAY = civilDate('2026-03-15');

const chore = (over: Partial<Chore> & { id: string; title: string }): Chore =>
  ({
    notes: null,
    schedule: {
      rule: { kind: 'daily', everyNDays: 1 },
      startsOn: TODAY,
      endsOn: null,
      timesOfDay: [],
    },
    assignment: { kind: 'anyone' },
    archived: false,
    archivedAt: null,
    categoryId: null,
    priority: 'normal',
    icon: null,
    ...over,
  }) as Chore;

const onceRule = { kind: 'once', dueOn: TODAY, granularity: 'day' } as const;

let mockChores: Chore[] = [];
let mockCompletions: { choreId: string; completedOn: string }[] = [];

jest.mock('@/data/hooks/useChores', () => ({
  useChoreList: () => ({
    data: { chores: mockChores, unreadable: [] },
    isLoading: false,
    error: null,
  }),
  useOneOffCompletions: () => ({ data: mockCompletions }),
  useToggleSomeday: () => ({ mutate: jest.fn() }),
}));

jest.mock('@/data/hooks/useHousehold', () => ({
  useHousehold: () => ({ data: { timeZone: 'UTC', weekStartsOn: 0 } }),
  useMembers: () => ({ data: [{ userId: 'me', displayName: 'Jake', accent: 'blue' }] }),
}));

// Mutable: the library groups by category, so what happens with none is a
// behaviour of its own rather than a detail of the fixture.
let mockCategories: { id: string; name: string; ink: string | null; position: number }[] = [];
jest.mock('@/data/hooks/useCategories', () => ({ useCategoryList: () => mockCategories }));
jest.mock('@/data/today', () => ({ useToday: () => '2026-03-15' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
const renderScreen = () =>
  render(
    <ThemeProvider>
      <ChoresScreen />
    </ThemeProvider>,
  );

beforeEach(() => {
  mockChores = [];
  mockCompletions = [];
  mockCategories = [];
});

describe('the library before anyone has made a category', () => {
  it('does not head the whole shelf "Other"', () => {
    // Grouping by category with no categories sends every chore to the
    // uncategorised bucket, which renders one heading reading "Other" over the
    // entire library — a line that says nothing. Today used to carry this
    // guard; the grouping moved here without it.
    mockChores = [chore({ id: 'dishes', title: 'Dishes' })];
    renderScreen();

    expect(screen.getByText('Dishes')).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: /Other/ })).toBeNull();
  });

  it('still heads each category once there is one', () => {
    // The other half, so the fix cannot be "never group at all".
    mockCategories = [{ id: 'c-kitchen', name: 'Kitchen', ink: 'teal', position: 0 }];
    mockChores = [chore({ id: 'dishes', title: 'Dishes', categoryId: 'c-kitchen' })];
    renderScreen();

    expect(screen.getByRole('header', { name: /Kitchen/ })).toBeOnTheScreen();
  });
});

describe('a one-time chore that has been done', () => {
  const wasps = chore({
    id: 'wasps',
    title: 'Kill wasps',
    schedule: {
      rule: onceRule,
      startsOn: TODAY,
      endsOn: null,
      timesOfDay: [],
    } as Chore['schedule'],
  });

  it('moves out of the active list into Done', () => {
    mockChores = [wasps, chore({ id: 'dishes', title: 'Dishes' })];
    mockCompletions = [{ choreId: 'wasps', completedOn: TODAY }];
    renderScreen();

    expect(screen.getByRole('header', { name: /Done/ })).toBeTruthy();
  });

  it('stays put while it is still outstanding', () => {
    // The non-vacuity check. Without it, a screen that hid every one-time
    // chore — or showed the Done header unconditionally — would pass above.
    mockChores = [wasps];
    mockCompletions = [];
    renderScreen();

    expect(screen.queryByRole('header', { name: /Done/ })).toBeNull();
    expect(screen.getByText('Kill wasps')).toBeTruthy();
  });

  it('is still on the screen, because it is history rather than clutter', () => {
    mockChores = [wasps];
    mockCompletions = [{ choreId: 'wasps', completedOn: TODAY }];
    renderScreen();

    expect(screen.getByText('Kill wasps')).toBeTruthy();
  });

  it('does not drag repeating chores down with it', () => {
    // A repeating chore is completed constantly and is never "done".
    mockChores = [chore({ id: 'dishes', title: 'Dishes' })];
    mockCompletions = [{ choreId: 'dishes', completedOn: TODAY }];
    renderScreen();

    expect(screen.queryByRole('header', { name: /Done/ })).toBeNull();
  });
});
