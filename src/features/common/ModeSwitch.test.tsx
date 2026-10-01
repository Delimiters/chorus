/**
 * The count on the Routines segment, tested where it is wired.
 *
 * `owedByNow` has its own unit tests and would pass with nothing rendering it —
 * the recurring defect in this project is a correct pure function that no
 * screen reaches. So these render the real `ModeSwitch` against a real clock
 * reading and a real routine projection, and assert what a person would see.
 */
import { render, screen } from '@testing-library/react-native';

import type { CivilDate, CivilTime } from '@/core/civil/types';
import { ThemeProvider } from '@/design/theme';

import { ModeSwitch } from './ModeSwitch';

/*
 * `dueOn` is in this fixture because leaving it out is what let a defect past
 * both this file and the unit tests. `useRoutineDay` returns a whole quantised
 * week — the Routines screen pages through it — so a harness whose occurrences
 * are all implicitly "today" is shaped differently from the real caller in
 * exactly the dimension that was broken.
 */
interface Occ {
  ownerId: string;
  dueOn: CivilDate;
  bucket: 'morning' | 'afternoon' | 'evening' | 'night';
  timeOfDay: CivilTime | null;
  status: 'upcoming' | 'due' | 'completed' | 'missed';
}

const TODAY = '2026-10-01' as CivilDate;

let mockOccurrences: Occ[] = [];
let mockNow = '09:00' as CivilTime;

jest.mock('@/data/hooks/useHousehold', () => ({
  useHousehold: () => ({ data: { timeZone: 'UTC' } }),
}));
jest.mock('@/data/hooks/useRoutines', () => ({
  useRoutineDay: () => ({ occurrences: mockOccurrences, summary: null, isLoading: false }),
}));
jest.mock('@/data/today', () => ({
  useToday: () => '2026-10-01',
  useNowTime: () => mockNow,
}));
jest.mock('@/stores/sessionStore', () => ({ useUserId: () => 'me' }));

const item = (over: Partial<Occ> = {}): Occ => ({
  ownerId: 'me',
  dueOn: TODAY,
  bucket: 'morning',
  timeOfDay: null,
  status: 'due',
  ...over,
});

const renderSwitch = () =>
  render(
    <ThemeProvider>
      <ModeSwitch mode="plan" onChange={jest.fn()} />
    </ThemeProvider>,
  );

beforeEach(() => {
  mockOccurrences = [];
  mockNow = '09:00' as CivilTime;
});

describe('the Routines segment', () => {
  it('shows nothing when the routine is caught up', () => {
    mockOccurrences = [item({ status: 'completed' }), item({ bucket: 'evening' })];

    renderSwitch();

    expect(screen.getByText('Routines')).toBeTruthy();
    expect(screen.queryByText('1')).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('counts what has come due and is not done', () => {
    mockOccurrences = [item(), item(), item({ bucket: 'night' })];

    renderSwitch();

    expect(screen.getByText('2')).toBeTruthy();
  });

  /*
   * The clock has to reach the count. Mocking `useNowTime` to the evening with
   * the same list must change the number — otherwise the badge is a total
   * wearing a timestamp, which is the thing it was built not to be.
   */
  it('grows as the day moves through its buckets', () => {
    mockOccurrences = [item({ bucket: 'morning' }), item({ bucket: 'evening' })];

    renderSwitch();
    expect(screen.getByText('1')).toBeTruthy();
    screen.unmount();

    mockNow = '18:00' as CivilTime;
    renderSwitch();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('caps the badge rather than widening the segment', () => {
    mockOccurrences = Array.from({ length: 12 }, () => item());

    renderSwitch();

    expect(screen.getByText('9+')).toBeTruthy();
  });

  /*
   * The week the real hook actually hands over. Without this the screen test
   * agreed with the unit tests and both were wrong together.
   */
  it('counts today out of the week the projection covers', () => {
    mockOccurrences = [
      item({ dueOn: '2026-09-28' as CivilDate, status: 'missed' }),
      item({ dueOn: '2026-09-29' as CivilDate, status: 'missed' }),
      item({ dueOn: '2026-09-30' as CivilDate, status: 'missed' }),
      item({ dueOn: TODAY }),
      item({ dueOn: '2026-10-02' as CivilDate, status: 'upcoming' }),
    ];

    renderSwitch();

    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.queryByText('4')).toBeNull();
  });

  it('announces the count, rather than drawing it for nobody', () => {
    mockOccurrences = [item(), item()];

    renderSwitch();

    expect(screen.getByLabelText('Routines, 2 due')).toBeTruthy();
    // And says just the name when there is nothing owed.
    screen.unmount();
    mockOccurrences = [];
    renderSwitch();
    expect(screen.getByLabelText('Routines')).toBeTruthy();
  });

  it('never counts your housemate’s shared routine', () => {
    mockOccurrences = [item({ ownerId: 'them' })];

    renderSwitch();

    expect(screen.queryByText('1')).toBeNull();
  });
});
