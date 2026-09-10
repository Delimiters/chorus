/**
 * Settings.
 *
 * The assertion worth making here is about the *words*: this screen's job is to
 * say which preferences are shared and which are only yours, and to admit the
 * one limitation of local notifications rather than let somebody discover it as
 * missing reminders.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { DEFAULT_POLICY } from '@/core/notify/plan';
import { ThemeProvider } from '@/design/theme';
import { useReminderStore } from '@/stores/reminderStore';
import { useViewStore } from '@/stores/viewStore';
import { SettingsScreen } from './SettingsScreen';

const mockUpdate = jest.fn();
let mockHousehold = { weekStartsOn: 0, timeZone: 'America/New_York' };

let mockMyGroupOrder: 'chores' | 'oneOff' = 'chores';
const mockSetGroupOrder = jest.fn();

jest.mock('@/data/hooks/useHousehold', () => ({
  useHousehold: () => ({ data: mockHousehold, isLoading: false, error: null }),
  useUpdateHousehold: () => ({ mutate: mockUpdate }),
  useMembers: () => ({
    /*
     * The housemate first, and always the opposite. With 'me' at index 0 the
     * assertions below passed against `members.data[0]`, which is the mis-read
     * they are supposed to catch.
     */
    data: [
      { userId: 'user-them', displayName: 'Sam', accent: 'pink', planGroupOrder: 'oneOff' },
      { userId: 'me', displayName: 'Jake', accent: 'blue', planGroupOrder: mockMyGroupOrder },
    ],
  }),
  useSetPlanGroupOrder: () => ({ mutate: mockSetGroupOrder }),
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
  mockMyGroupOrder = 'chores';
  mockSetGroupOrder.mockClear();
});

describe('which group leads your plan', () => {
  /*
   * A duplicate of the control on the plan itself, deliberately: "↑ First" on a
   * section heading is easy to miss, and Settings is where a standing
   * preference is looked for. Both read the same profile row, so they cannot
   * disagree.
   */
  it('shows your current order, not your housemate’s', async () => {
    mockMyGroupOrder = 'chores';
    await renderScreen();

    expect(screen.getByRole('tab', { name: 'Chores', selected: true })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'One-time tasks', selected: false })).toBeOnTheScreen();
  });

  it('reflects the other choice when that is yours', async () => {
    mockMyGroupOrder = 'oneOff';
    await renderScreen();

    expect(screen.getByRole('tab', { name: 'One-time tasks', selected: true })).toBeOnTheScreen();
  });

  it('saves the change against your profile', async () => {
    await renderScreen();

    await fireEvent.press(screen.getByRole('tab', { name: 'One-time tasks' }));

    expect(mockSetGroupOrder).toHaveBeenCalledWith('oneOff');
  });

  it('says whose preference it is, since every other display setting is per phone', async () => {
    await renderScreen();
    expect(screen.getByText(/your housemate keeps their own order/i)).toBeOnTheScreen();
  });
});

describe('household settings', () => {
  it('changes the week start, and says what that affects', async () => {
    await renderScreen();
    expect(screen.getByText(/Changes which day weekly chores start on/)).toBeOnTheScreen();

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
    expect(screen.getByText(/Set on this phone, for this phone/)).toBeOnTheScreen();
  });

  it('turns reminders off and hides what no longer applies', async () => {
    await renderScreen();
    expect(screen.getByRole('tab', { name: '9am' })).toBeOnTheScreen();

    await fireEvent(screen.getByLabelText('Chore reminders'), 'valueChange', false);

    expect(useReminderStore.getState().policy.enabled).toBe(false);
    expect(screen.queryByRole('tab', { name: '9am' })).toBeNull();
  });

  it('changes the default time', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByRole('tab', { name: '7am' }));
    expect(useReminderStore.getState().policy.defaultTime).toBe('07:00');
  });

  it('says what including unassigned chores will do', async () => {
    /*
     * The hint describes the effect on the reader — both of you get the
     * reminder — rather than arguing for the default, which is what it used to
     * do and which is a note to ourselves.
     */
    await renderScreen();
    expect(screen.getByText(/only gets these if they turn it on as well/)).toBeOnTheScreen();

    await fireEvent(
      screen.getByLabelText('Remind me about unassigned chores'),
      'valueChange',
      true,
    );
    expect(useReminderStore.getState().policy.includeUnassigned).toBe(true);
  });

  it('groups notifications under their own heading', async () => {
    /*
     * They used to sit under "On this phone" with the row-density switch, so
     * the longest and most consequential part of the screen had no heading of
     * its own. Jake: *"things are just thrown in there with no context or
     * headers."*
     */
    await renderScreen();
    expect(screen.getByRole('header', { name: /Notifications/ })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: /Display/ })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: /Household/ })).toBeOnTheScreen();
  });

  it('no longer offers a test notification', async () => {
    // A debugging affordance that shipped to the household and stayed.
    await renderScreen();
    expect(screen.queryByText(/test reminder/i)).toBeNull();
  });
});

describe('when this build cannot schedule notifications at all', () => {
  it('says so rather than offering a switch that does nothing', async () => {
    // Expo Go and the web build both land here. A toggle that silently fails
    // is worse than an honest sentence.
    mockAvailable = false;
    await renderScreen();
    expect(screen.getByText(/not in a browser/)).toBeOnTheScreen();
    // The label was renamed, so this queried a string the screen never renders:
    // the test passed while the screen showed both the message *and* the switch.
    expect(screen.queryByLabelText('Chore reminders')).toBeNull();
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
      expect(screen.getByText(new RegExp(`This phone is set to ${device}`))).toBeOnTheScreen();
    }
  });

  it('says nothing when they agree', async () => {
    mockHousehold = {
      weekStartsOn: 0,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    await renderScreen();
    expect(screen.queryByText(/This phone is set to/)).toBeNull();
    expect(screen.getByText(/Decides when a day starts and ends/)).toBeOnTheScreen();
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
    expect(screen.getByText(/all 14 items in your routine/)).toBeTruthy();
  });

  it('does not offer a count when there is nothing to count', async () => {
    await renderScreen();
    // `things` became `items` in the copy, so this regex could no longer match
    // anything the screen renders — it passed with the zero branch deleted.
    expect(screen.queryByText(/all 0 items/)).toBeNull();
  });

  it('writes the switch through to the household, not to this phone', async () => {
    await renderScreen();
    fireEvent(screen.getByLabelText('Share my routine with the household'), 'valueChange', true);
    expect(mockSetShare).toHaveBeenCalledWith({ shared: true });
  });

  it('keeps sharing here, because it is a fact about you rather than a view', () => {
    // Sharing writes to your membership row and only you may write it. Whose
    // routines you *look at* is a property of the screen you are looking at,
    // and lives there now.
    return renderScreen().then(() => {
      expect(screen.getByLabelText('Share my routine with the household')).toBeTruthy();
      expect(screen.queryByLabelText("Show other people's routines")).toBeNull();
    });
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

describe('being told about a new chore', () => {
  it('is not offered, because nothing delivers it yet', async () => {
    /*
     * The switch wrote a preference nothing reads: announcing a chore your
     * housemate added needs a push from their phone to yours, which needs a
     * paid Apple account. A control that cannot do anything is worse than its
     * absence — this screen already hides the reminder switch on a build that
     * cannot schedule reminders, for the same reason.
     */
    await renderScreen();

    expect(screen.queryByLabelText('Tell me when a chore is added')).toBeNull();
    expect(screen.queryByText(/New chores/)).toBeNull();
  });

  it('keeps the stored preference, so the setting returns with the feature', () => {
    // Removing the control must not quietly discard what people had set.
    expect(DEFAULT_POLICY.announceNewChores).toBe(true);
  });
});

describe('every switch writes the setting it names', () => {
  /*
   * Four of these had no test on this branch or on main, which is how a hint
   * describing the wrong gesture reached the phone: nothing on this screen was
   * checked against what the control actually does.
   *
   * Each asserts the store afterwards, so re-pointing a switch at a neighbour's
   * setter fails here rather than shipping.
   */
  it("includes other people's chores", async () => {
    await renderScreen();
    await fireEvent(
      screen.getByLabelText("Remind me about other people's chores"),
      'valueChange',
      true,
    );
    expect(useReminderStore.getState().policy.includeOthers).toBe(true);
  });

  it('includes routine reminders', async () => {
    await renderScreen();
    await fireEvent(screen.getByLabelText('Routine reminders'), 'valueChange', false);
    expect(useReminderStore.getState().policy.includeRoutines).toBe(false);
  });

  it('sets compact rows on this phone', async () => {
    // Toggled *off*: the default is on, so asserting `true` would pass without
    // the switch being wired to anything at all.
    await renderScreen();
    await fireEvent(screen.getByLabelText('Compact rows'), 'valueChange', false);
    expect(useViewStore.getState().view.compactRows).toBe(false);
  });
});

describe('the words on the screen', () => {
  it('names the gesture that actually expands a row', async () => {
    /*
     * The row's own press opens the options sheet; the chevron is what expands
     * it. This hint told the reader to tap the row, which does something else —
     * introduced by the very commit that was meant to make the copy clearer.
     */
    await renderScreen();

    expect(screen.getByText(/Tap the chevron on a row/)).toBeOnTheScreen();
  });

  it('does not claim a per-phone switch speaks for the other phone', async () => {
    // `includeUnassigned` lives in this phone's store. Turning it on cannot
    // cause a housemate to be reminded of anything.
    await renderScreen();

    expect(screen.queryByText(/Both of you will be reminded/)).toBeNull();
  });

  it('says which settings are shared and which are this phone only', async () => {
    // The old headings carried this and the rewrite dropped it, which is the
    // one thing the screen's own docblock says it exists to do.
    await renderScreen();

    expect(screen.getByRole('header', { name: /Household/ })).toBeOnTheScreen();
    // Display and Notifications both say it, which is the point.
    expect(screen.getAllByRole('header', { name: /on this phone/i })).toHaveLength(2);
  });
});
