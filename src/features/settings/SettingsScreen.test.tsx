/**
 * Settings.
 *
 * The assertion worth making here is about the *words*: this screen's job is to
 * say which preferences are shared and which are only yours, and to admit the
 * one limitation of local notifications rather than let somebody discover it as
 * missing reminders.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { DEFAULT_POLICY, MAX_PENDING } from '@/core/notify/plan';
import { ThemeProvider } from '@/design/theme';
import { useReminderStore } from '@/stores/reminderStore';
import { SettingsScreen } from './SettingsScreen';

const mockUpdate = jest.fn();
let mockHousehold = { weekStartsOn: 0, timeZone: 'America/New_York' };

jest.mock('@/data/hooks/useHousehold', () => ({
  useHousehold: () => ({ data: mockHousehold, isLoading: false, error: null }),
  useUpdateHousehold: () => ({ mutate: mockUpdate }),
}));

let mockAvailable = true;
// The screen can delete an account, which is a mutation. This suite renders
// without a QueryClientProvider on purpose — it mocks the data layer rather
// than standing one up.
jest.mock('@/data/hooks/useAuth', () => ({
  useDeleteAccount: () => ({ mutate: jest.fn(), isPending: false, error: null }),
}));

let mockSharedByMe = false;
let mockRoutineCount = 0;
const mockSetShare = jest.fn();

jest.mock('@/data/hooks/useRoutines', () => ({
  useRoutineItems: () => ({
    data: {
      items: Array.from({ length: mockRoutineCount }, (_, i) => ({
        id: `r${i}`,
        ownerId: 'me',
      })),
      unreadable: [],
      sharedByMe: mockSharedByMe,
    },
    isPending: false,
    error: null,
  }),
  useSetShareRoutine: () => ({ mutate: mockSetShare, isPending: false, isError: false }),
}));

jest.mock('@/stores/sessionStore', () => ({ useUserId: () => 'me' }));

// jest-expo does not populate the manifest, so the values are supplied here.
// The point of the assertion is that the screen reads them from the manifest
// rather than hardcoding a number that then goes stale.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '9.9.9', ios: { buildNumber: '42' } } },
}));

jest.mock('@/data/notifications', () => ({
  get notificationsAvailable() {
    return mockAvailable;
  },
}));

async function renderScreen() {
  return render(
    <ThemeProvider>
      <SettingsScreen />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockUpdate.mockClear();
  mockHousehold = { weekStartsOn: 0, timeZone: 'America/New_York' };
  useReminderStore.setState({ policy: DEFAULT_POLICY });
  mockAvailable = true;
});

describe('household settings', () => {
  it('changes the week start, and says what that affects', async () => {
    await renderScreen();
    expect(screen.getByText(/Changes the calendar and every weekly chore/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('tab', { name: 'Monday' }));
    expect(mockUpdate).toHaveBeenCalledWith({ weekStartsOn: 1 });
  });

  it('shows the household time zone', async () => {
    await renderScreen();
    expect(screen.getByText('America/New_York')).toBeOnTheScreen();
  });
});

describe('reminder settings', () => {
  it('says reminders are per-device, because that is not obvious', async () => {
    // Two people sharing a chore list would reasonably assume a shared
    // reminder time. A local notification cannot work that way.
    await renderScreen();
    expect(screen.getByText(/A reminder can only reach the phone that set it/)).toBeOnTheScreen();
  });

  it('turns reminders off and hides what no longer applies', async () => {
    await renderScreen();
    expect(screen.getByRole('tab', { name: '9am' })).toBeOnTheScreen();

    await fireEvent(screen.getByLabelText('Remind me about my chores'), 'valueChange', false);

    expect(useReminderStore.getState().policy.enabled).toBe(false);
    expect(screen.queryByRole('tab', { name: '9am' })).toBeNull();
  });

  it('changes the default time', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByRole('tab', { name: '7am' }));
    expect(useReminderStore.getState().policy.defaultTime).toBe('07:00');
  });

  it('explains why unassigned chores are off by default', async () => {
    await renderScreen();
    expect(screen.getByText(/both phones would buzz about the same job/)).toBeOnTheScreen();
    await fireEvent(
      screen.getByLabelText('Remind me about unassigned chores'),
      'valueChange',
      true,
    );
    expect(useReminderStore.getState().policy.includeUnassigned).toBe(true);
  });

  it('admits the queue limit rather than letting reminders vanish quietly', async () => {
    // The one thing about local notifications that will otherwise look like a
    // bug: past the cap, later reminders simply never arrive.
    await renderScreen();
    expect(screen.getByText(new RegExp(String(MAX_PENDING)))).toBeOnTheScreen();
  });
});

describe('when this build cannot schedule notifications at all', () => {
  it('says so rather than offering a switch that does nothing', async () => {
    // Expo Go and the web build both land here. A toggle that silently fails
    // is worse than an honest sentence.
    mockAvailable = false;
    await renderScreen();
    expect(screen.getByText(/cannot schedule them/)).toBeOnTheScreen();
    expect(screen.queryByLabelText('Remind me about my chores')).toBeNull();
  });
});

describe('when the phone and the household disagree about the time zone', () => {
  it('says so, because it changes which day a chore is due', async () => {
    mockHousehold = { weekStartsOn: 0, timeZone: 'Pacific/Kiritimati' };
    await renderScreen();
    // The device zone comes from Intl, whatever the test runner is in; the
    // point is that a mismatch is reported at all.
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (device !== 'Pacific/Kiritimati') {
      expect(screen.getByText(new RegExp(`This phone is in ${device}`))).toBeOnTheScreen();
    }
  });

  it('says nothing when they agree', async () => {
    mockHousehold = {
      weekStartsOn: 0,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    await renderScreen();
    expect(screen.queryByText(/This phone is in/)).toBeNull();
    expect(screen.getByText(/Decides which day a chore is due on/)).toBeOnTheScreen();
  });
});

describe('deleting your account', () => {
  it('does not offer it as a single tap', async () => {
    // Apple requires deletion to be reachable in-app. It does not require it
    // to be reachable by accident.
    await renderScreen();
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Yes, delete my account' })).toBeNull();
  });

  it('says what survives before asking again', async () => {
    // The part nobody would guess, and the reason the schema was reshaped:
    // your completions stay, so your housemate keeps their history.
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
    expect(screen.getByText(/stay in the household/)).toBeTruthy();
    expect(screen.getByText(/cannot be undone/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yes, delete my account' })).toBeTruthy();
  });

  it('can be backed out of', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Keep my account' }));
    expect(screen.queryByRole('button', { name: 'Yes, delete my account' })).toBeNull();
  });
});

describe('routine sharing', () => {
  beforeEach(() => {
    mockSharedByMe = false;
    mockRoutineCount = 0;
    mockSetShare.mockClear();
  });

  it('offers a switch at all — which is the whole finding', () => {
    // Sharing shipped as a column, a policy, an API call and a mutation hook,
    // with no control anywhere in the app. Every test passed through the layer
    // the missing screen would have used.
    return renderScreen().then(() => {
      expect(screen.getByLabelText('Share my routine with the household')).toBeTruthy();
    });
  });

  it('says how much turning it on would reveal', async () => {
    mockRoutineCount = 14;
    await renderScreen();
    expect(screen.getByText(/all 14 things in your routine/)).toBeTruthy();
  });

  it('does not offer a count when there is nothing to count', async () => {
    await renderScreen();
    expect(screen.queryByText(/all 0 things/)).toBeNull();
  });

  it('writes the switch through to the household, not to this phone', async () => {
    await renderScreen();
    fireEvent(screen.getByLabelText('Share my routine with the household'), 'valueChange', true);
    expect(mockSetShare).toHaveBeenCalledWith({ shared: true });
  });

  it('describes showing others as a display setting, not a privacy one', async () => {
    await renderScreen();
    expect(screen.getByText(/display setting, not a privacy one/)).toBeTruthy();
  });
});

describe('which build am I looking at', () => {
  it('shows the version and build number from the manifest', async () => {
    // Every build so far reported 1.0.0 (1) on both phones, so "did that
    // install actually take" could only be answered from outside the app.
    await renderScreen();
    expect(screen.getByText('Chorus 9.9.9 (42)')).toBeTruthy();
  });
});
