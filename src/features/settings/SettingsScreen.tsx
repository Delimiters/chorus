/**
 * Settings, grouped by what a change actually affects.
 *
 * Household settings are shared and either person can change them. Everything
 * else — notifications, display — is per phone, because a reminder is scheduled
 * by the device that shows it and cannot be set for somebody else.
 *
 * ── A note on the copy ────────────────────────────────────────────────────
 *
 * Every hint here describes what the setting does for the person reading it.
 * It does not explain why the default was chosen, name internal concepts
 * ("buckets", "the queue"), or refer to how the app is built. That is what this
 * screen used to do — Jake: *"super AI sounding descriptions that like
 * reference specific context of our conversations"* — and it read as notes to
 * ourselves left on the page.
 */

import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CivilTime, Weekday } from '@/core/civil/types';
import { useHousehold, useUpdateHousehold } from '@/data/hooks/useHousehold';
import { notificationsAvailable } from '@/data/notifications';
import { SectionHeader } from '@/design/ChoreRow';
import { BackBar, Button, ErrorState, LoadingState, Stack, Txt } from '@/design/components';
import { FieldGroup, SegmentedControl } from '@/design/controls';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { useReminderStore } from '@/stores/reminderStore';
import { BUCKETS, bucketRange, describeBucket, type TimeBucket } from '@/core/routines/buckets';
import { SingleTimeField } from '@/features/common/SingleTimeField';
import { useRoutineItems, useSetShareRoutine } from '@/data/hooks/useRoutines';
import { useUserId } from '@/stores/sessionStore';
import { useViewPreference, useViewStore } from '@/stores/viewStore';
import { useDeleteAccount } from '@/data/hooks/useAuth';
import { REMINDER_TIMES } from '@/design/times';

/**
 * One-tap choices per bucket, inside that bucket's own window.
 *
 * Offering 7am for the Night reminder would schedule it outside the window it
 * is about, so each list is drawn from its own part of the day.
 */
const BUCKET_PRESETS: Record<TimeBucket, readonly CivilTime[]> = {
  morning: ['06:00', '07:00', '08:00', '09:00'] as CivilTime[],
  afternoon: ['12:00', '12:30', '13:00', '15:00'] as CivilTime[],
  evening: ['17:00', '17:30', '18:00', '19:00'] as CivilTime[],
  night: ['20:00', '20:30', '21:00', '22:00'] as CivilTime[],
};

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
  const { compactRows } = useViewPreference();
  const setCompactRows = useViewStore((state) => state.setCompactRows);
  const router = useRouter();
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
  const setBucketTime = useReminderStore((s) => s.setBucketTime);
  const setAnnounceNewChores = useReminderStore((s) => s.setAnnounceNewChores);
  const userId = useUserId();
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

        <SectionHeader title="Household" />
        <Stack gap={space.sm}>
          <FieldGroup label="Week starts on" hint="Used by weekly chores and by the calendar.">
            <SegmentedControl
              segments={WEEK_STARTS}
              value={weekStartsOn}
              onChange={(value) =>
                updateHousehold.mutate({ weekStartsOn: Number(value) as Weekday })
              }
              label="Week starts on"
            />
          </FieldGroup>

          {row(
            'Time zone',
            deviceZone !== null && deviceZone !== timeZone
              ? `This phone is set to ${deviceZone}, but chore dates follow ${timeZone}.`
              : 'Decides when a day starts and ends for due dates.',
            <Txt variant="small" tone="faint">
              {timeZone}
            </Txt>,
          )}
        </Stack>

        <SectionHeader title="Display" />
        <Stack gap={space.sm}>
          {row(
            'Compact rows',
            'Show each chore on one line. Tap a row to see its schedule, notes and steps.',
            <Switch
              value={compactRows}
              onValueChange={setCompactRows}
              accessibilityLabel="Compact rows"
            />,
          )}
        </Stack>

        <SectionHeader title="Notifications" />
        <Stack gap={space.sm}>
          {!notificationsAvailable ? (
            <Txt variant="small" tone="faint">
              Notifications aren&apos;t available in this build.
            </Txt>
          ) : (
            <>
              {row(
                'Chore reminders',
                'A notification when one of your chores is due. Set on this phone, for this phone.',
                <Switch
                  value={policy.enabled}
                  onValueChange={setEnabled}
                  accessibilityLabel="Chore reminders"
                />,
              )}

              {policy.enabled ? (
                <>
                  <FieldGroup
                    label="Default time"
                    hint="When to remind you about chores that have no time of their own."
                  >
                    <SegmentedControl
                      segments={REMINDER_TIMES}
                      value={policy.defaultTime}
                      onChange={(value) => setDefaultTime(value as CivilTime)}
                      label="Reminder time"
                    />
                  </FieldGroup>

                  {row(
                    'Unassigned chores',
                    'Also remind me about chores that are not assigned to anyone. Both of you will be reminded.',
                    <Switch
                      value={policy.includeUnassigned}
                      onValueChange={setIncludeUnassigned}
                      accessibilityLabel="Remind me about unassigned chores"
                    />,
                  )}

                  {row(
                    "Everyone else's chores",
                    'Also remind me about chores assigned to someone else.',
                    <Switch
                      value={policy.includeOthers}
                      onValueChange={setIncludeOthers}
                      accessibilityLabel="Remind me about other people's chores"
                    />,
                  )}

                  {row(
                    'Routine reminders',
                    'One reminder for each part of the day, plus one for anything you gave a specific time.',
                    <Switch
                      value={policy.includeRoutines}
                      onValueChange={setIncludeRoutines}
                      accessibilityLabel="Remind me about my routine"
                    />,
                  )}

                  {policy.includeRoutines ? (
                    <>
                      {/*
                        The time set here is when the reminder is *sent*, not
                        when that part of the day begins — morning begins at
                        05:00, which nobody wants to be told about their
                        stretches. The window is shown beside each so the two
                        cannot be mistaken for one another.
                      */}
                      <Txt variant="small" tone="faint" style={{ paddingHorizontal: space.md }}>
                        Choose when each reminder is sent. The times in brackets are the part of the
                        day it covers.
                      </Txt>
                      {BUCKETS.map((bucket) => {
                        const range = bucketRange(bucket);
                        return (
                          <SingleTimeField
                            key={bucket}
                            label={`${describeBucket(bucket)} (${range.from}–${range.to})`}
                            value={policy.bucketTimes[bucket]}
                            presets={BUCKET_PRESETS[bucket]}
                            onChange={(time) => setBucketTime(bucket, time)}
                          />
                        );
                      })}
                    </>
                  ) : null}

                  {row(
                    'New chores',
                    'Tell me when someone adds a chore to the household.',
                    <Switch
                      value={policy.announceNewChores}
                      onValueChange={setAnnounceNewChores}
                      accessibilityLabel="Tell me when a chore is added"
                    />,
                  )}
                </>
              ) : null}
            </>
          )}
        </Stack>

        {/*
          Sharing follows you rather than this phone: it is stored on your
          household membership, so it holds wherever you sign in.
        */}
        <SectionHeader title="Routines" />
        <Stack gap={space.sm}>
          {row(
            'Share my routine',
            sharedByMe
              ? 'Your housemate can see your routine and what you have ticked off. They cannot change it.'
              : myRoutineCount === 0
                ? 'Your routine is private until you turn this on.'
                : `Turning this on shows all ${myRoutineCount} items in your routine, not just new ones.`,
            <Switch
              value={sharedByMe}
              onValueChange={(shared) => setShareRoutine.mutate({ shared })}
              disabled={setShareRoutine.isPending}
              accessibilityLabel="Share my routine with the household"
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
                This deletes your account and signs you out. Chores you ticked off stay in the
                household&apos;s history under your name. If nobody is left in the household, it is
                deleted too. This cannot be undone.
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

        {/* Read from the manifest, so bumping app.json is the only step. */}
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
