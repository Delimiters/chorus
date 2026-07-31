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

jest.mock('@/data/notifications', () => ({ notificationsAvailable: true }));

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
