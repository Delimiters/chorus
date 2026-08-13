/**
 * Settings.
 *
 * Two groups, and the split is the point: things about *the household*, which
 * both people share and either can change, and things about *this device*,
 * which are yours alone. Reminder preferences are the second kind — a local
 * notification fires from the phone that scheduled it, so a shared reminder time
 * would mean one of you silently getting the other's.
 *
 * The screen says which is which rather than leaving it to be discovered when
 * somebody's 7am alarm changes.
 */

import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CivilTime, Weekday } from '@/core/civil/types';
import { MAX_PENDING } from '@/core/notify/plan';
import { useHousehold, useUpdateHousehold } from '@/data/hooks/useHousehold';
import { notificationsAvailable, sendTestNotification } from '@/data/notifications';
import { SectionHeader } from '@/design/ChoreRow';
import { BackBar, Button, ErrorState, LoadingState, Stack, Txt } from '@/design/components';
import { FieldGroup, SegmentedControl } from '@/design/controls';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { useReminderStore } from '@/stores/reminderStore';
import { useRoutineStore } from '@/stores/routineStore';
import { useRoutineItems, useSetShareRoutine } from '@/data/hooks/useRoutines';
import { useUserId } from '@/stores/sessionStore';
import { useDeleteAccount } from '@/data/hooks/useAuth';
import { REMINDER_TIMES } from '@/design/times';

/** Times people actually pick. A free-text time field is a keyboard for nothing. */
const WEEK_STARTS: readonly { value: string; label: string }[] = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '6', label: 'Saturday' },
];

/** From the manifest, so a version bump needs no code change. */
const appVersion = Constants.expoConfig?.version ?? '—';
const buildNumber =
  Platform.OS === 'ios'
    ? (Constants.expoConfig?.ios?.buildNumber ?? '—')
    : String(Constants.expoConfig?.android?.versionCode ?? '—');

export function SettingsScreen() {
  const router = useRouter();
  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent' | 'denied'>('idle');
  /**
   * Two steps, and the confirming step spells out what survives.
   *
   * Apple requires deletion to be reachable in-app; it does not require it to
   * be reachable by accident. The wording matters more than the extra tap —
   * "your completions stay, your housemate keeps their history" is the part
   * nobody would guess.
   */
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteAccount = useDeleteAccount();
  const { colors } = useTheme();
  const household = useHousehold();
  const updateHousehold = useUpdateHousehold();

  const policy = useReminderStore((s) => s.policy);
  const setEnabled = useReminderStore((s) => s.setEnabled);
  const setDefaultTime = useReminderStore((s) => s.setDefaultTime);
  const setIncludeUnassigned = useReminderStore((s) => s.setIncludeUnassigned);
  const setIncludeOthers = useReminderStore((s) => s.setIncludeOthers);
  const setIncludeRoutines = useReminderStore((s) => s.setIncludeRoutines);
  const userId = useUserId();
  const showOthers = useRoutineStore((s) => s.preference.showOthers);
  const setShowOthers = useRoutineStore((s) => s.setShowOthers);
  const routineItems = useRoutineItems();
  const setShareRoutine = useSetShareRoutine();
  const sharedByMe = routineItems.data?.sharedByMe ?? false;
  const myRoutineCount = routineItems.data?.items.filter((i) => i.ownerId === userId).length ?? 0;

  const weekStartsOn = String(household.data?.weekStartsOn ?? 0);
  const timeZone = household.data?.timeZone ?? 'UTC';

  /** The device's zone, for the "this looks wrong" case below. */
  const deviceZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  }, []);

  if (household.isLoading) return <LoadingState />;
  if (household.error) return <ErrorState message={(household.error as Error).message} />;

  const row = (label: string, hint: string | null, control: React.ReactNode) => (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingVertical: space.sm,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        backgroundColor: colors.sunken,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="body">{label}</Txt>
        {hint === null ? null : (
          <Txt variant="small" tone="faint">
            {hint}
          </Txt>
        )}
      </View>
      {control}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl }}>
        <BackBar onPress={() => (router.canGoBack() ? router.back() : router.replace('/house'))} />

        <Txt variant="display" accessibilityRole="header">
          Settings
        </Txt>

        <SectionHeader title="This household" />
        <Stack gap={space.sm}>
          <FieldGroup label="Weeks start on" hint="Changes the calendar and every weekly chore.">
            <SegmentedControl
              segments={WEEK_STARTS}
              value={weekStartsOn}
              onChange={(value) =>
                updateHousehold.mutate({ weekStartsOn: Number(value) as Weekday })
              }
              label="Weeks start on"
            />
          </FieldGroup>

          {row(
            'Time zone',
            deviceZone !== null && deviceZone !== timeZone
              ? `This phone is in ${deviceZone}. Chores are due on ${timeZone} days.`
              : 'Decides which day a chore is due on.',
            <Txt variant="small" tone="faint">
              {timeZone}
            </Txt>,
          )}
        </Stack>

        <SectionHeader title="On this phone" />
        <Stack gap={space.sm}>
          {!notificationsAvailable ? (
            <Txt variant="small" tone="faint">
              Reminders need the phone app — this build cannot schedule them.
            </Txt>
          ) : (
            <>
              {row(
                'Remind me',
                'Only about your own chores. A reminder can only reach the phone that set it.',
                <Switch
                  value={policy.enabled}
                  onValueChange={setEnabled}
                  accessibilityLabel="Remind me about my chores"
                />,
              )}

              {/*
                Outside the `enabled` branch on purpose. A diagnostic that
                hides exactly when the thing it diagnoses is switched off is
                backwards — and "reminders are off" is itself one of the
                answers it exists to give.
              */}
              <View style={{ paddingTop: space.xs, gap: space.xs }}>
                <Button
                  label={testState === 'sent' ? 'Sent — watch for it' : 'Send a test reminder'}
                  variant="ghost"
                  onPress={() => {
                    setTestState('sending');
                    void sendTestNotification().then(setTestState);
                  }}
                  loading={testState === 'sending'}
                />
                <Txt variant="small" tone="faint">
                  {testState === 'denied'
                    ? 'iOS is blocking notifications for Chorus. Turn them on in the iOS Settings app, under Chorus.'
                    : 'Arrives in about five seconds, whether or not reminders are on above. A real reminder shows no banner while the app is open — this one does, on purpose.'}
                </Txt>
              </View>

              {policy.enabled ? (
                <>
                  <FieldGroup label="At" hint="Used when a chore has no time of its own.">
                    <SegmentedControl
                      segments={REMINDER_TIMES}
                      value={policy.defaultTime}
                      onChange={(value) => setDefaultTime(value as CivilTime)}
                      label="Reminder time"
                    />
                  </FieldGroup>

                  {row(
                    'Also unassigned chores',
                    'Off by default: both phones would buzz about the same job.',
                    <Switch
                      value={policy.includeUnassigned}
                      onValueChange={setIncludeUnassigned}
                      accessibilityLabel="Remind me about unassigned chores"
                    />,
                  )}

                  {row(
                    "Also everyone else's chores",
                    'Reminders for jobs that are not yours. Useful if you cover for each other; it also roughly doubles the queue below.',
                    <Switch
                      value={policy.includeOthers}
                      onValueChange={setIncludeOthers}
                      accessibilityLabel="Remind me about other people's chores"
                    />,
                  )}

                  {row(
                    'My routine',
                    'One notification per bucket, plus one for anything you gave a specific time. Three days ahead, not thirty.',
                    <Switch
                      value={policy.includeRoutines}
                      onValueChange={setIncludeRoutines}
                      accessibilityLabel="Remind me about my routine"
                    />,
                  )}

                  {/*
                    Stated rather than hidden. iOS holds a fixed number of
                    pending notifications and drops the rest silently, so a very
                    busy household would otherwise find its later reminders
                    simply never arriving with nothing to explain it.
                  */}
                  <Txt variant="small" tone="faint" style={{ paddingHorizontal: space.md }}>
                    {Platform.OS === 'ios'
                      ? `iOS holds ${MAX_PENDING} reminders at a time. Past that, the nearest ones win.`
                      : `Up to ${MAX_PENDING} reminders are scheduled at a time.`}
                  </Txt>
                </>
              ) : null}
            </>
          )}
        </Stack>
        {/*
          Sharing is a fact about you, not about this phone — the switch writes
          to your membership row, and only you can write it. "Show others"
          sits beside it because the two are constantly confused, and the copy
          has to be exact about which one is the privacy control.
        */}
        <SectionHeader title="Routines" />
        <Stack gap={space.sm}>
          {row(
            'Share my routine',
            sharedByMe
              ? 'Your housemate can see your routine and what you have ticked off. They cannot change it.'
              : myRoutineCount === 0
                ? 'Off. Your routine is yours alone until you switch this on.'
                : `Off. Switching it on shows all ${myRoutineCount} things in your routine, not just the ones you add afterwards.`,
            <Switch
              value={sharedByMe}
              onValueChange={(shared) => setShareRoutine.mutate({ shared })}
              disabled={setShareRoutine.isPending}
              accessibilityLabel="Share my routine with the household"
            />,
          )}

          {row(
            "Show others' routines",
            'Hides housemates\u2019 routines on your screen. A display setting, not a privacy one — what they share is up to them.',
            <Switch
              value={showOthers}
              onValueChange={setShowOthers}
              accessibilityLabel="Show other people's routines"
            />,
          )}

          {setShareRoutine.isError ? (
            <Txt variant="small" tone="danger" style={{ paddingHorizontal: space.md }}>
              That did not save. Check your connection and try again.
            </Txt>
          ) : null}
        </Stack>

        <SectionHeader title="Account" />
        <Stack gap={space.sm}>
          {confirmingDelete ? (
            <>
              <Txt variant="small" tone="danger">
                This deletes your account and signs you out. Chores you have ticked off stay in the
                household&apos;s history, still showing your name — your housemate keeps their
                record. A household with nobody left in it is deleted with you. This cannot be
                undone.
              </Txt>
              <Button
                label="Yes, delete my account"
                variant="danger"
                onPress={() => deleteAccount.mutate()}
                loading={deleteAccount.isPending}
              />
              <Button
                label="Keep my account"
                variant="ghost"
                onPress={() => setConfirmingDelete(false)}
              />
            </>
          ) : (
            <Button
              label="Delete my account"
              variant="ghost"
              onPress={() => setConfirmingDelete(true)}
            />
          )}
          {deleteAccount.error ? (
            <Txt variant="small" tone="danger">
              {(deleteAccount.error as Error).message}
            </Txt>
          ) : null}
        </Stack>

        {/*
          Which build am I looking at.
          
          Both phones reported 1.0.0 (1) for every build ever made, so "did the
          install take" could only be answered by remembering what was last
          run. Read from the manifest rather than hardcoded, so bumping
          app.json is the only step.
        */}
        <Txt
          variant="small"
          tone="faint"
          selectable
          style={{ paddingTop: space.xl, textAlign: 'center' }}
        >
          {`Chorus ${appVersion} (${buildNumber})`}
        </Txt>
      </ScrollView>
    </SafeAreaView>
  );
}
