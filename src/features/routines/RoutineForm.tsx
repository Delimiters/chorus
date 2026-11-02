/**
 * Creating and editing a routine item.
 *
 * Presentational, like `ChoreForm`: every mutation arrives as a plain callback,
 * so the whole form is testable without standing up a QueryClient.
 *
 * Most of it is the chore form's pickers, which are entity-agnostic and now
 * live in `features/common`. What is new is the pair at the top — a time *or* a
 * part of the day, never both — and the reminder row, whose hint names the time
 * a reminder would actually arrive.
 */

import DateTimePicker from '@react-native-community/datetimepicker';
import { useMemo, useState } from 'react';
import { Platform, ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ROUTINE_NOTES_MAX, ROUTINE_TITLE_MAX } from '@/core/text/limits';
import { formatCivilTime } from '@/core/civil/time';
import type { CalendarConfig, CivilDate, CivilTime } from '@/core/civil/types';
import type { Schedule } from '@/core/recurrence/types';
import { BUCKETS, bucketStart, describeBucket, type TimeBucket } from '@/core/routines/buckets';
import type { RoutineDraft, RoutineItem } from '@/data/api/routines';
import { BackBar, Button, ErrorState, Field, Stack, Txt } from '@/design/components';
import { FieldGroup, SegmentedControl } from '@/design/controls';
import { toIconName, type IconName } from '@/design/icons';
import { space } from '@/design/tokens';
import { DateField } from '@/features/common/DateField';
import { IconPicker } from '@/features/common/IconPicker';
import {
  RecurrencePicker,
  draftFromRule,
  type RecurrenceDraft,
} from '@/features/common/RecurrencePicker';
import { SchedulePreview } from '@/features/common/SchedulePreview';
import type { Chore } from '@/data/api/chores';
import { fromPickerDate, toPickerDate } from '@/features/common/TimeField';
import { ChoreLinkPicker } from './ChoreLinkPicker';

/** "No particular time" is a real answer, so it needs a real option. */
const NO_TIME = 'none';

/** The one that opens the wheel. Never a stored value. */
const OTHER_TIME = 'other';

const TIME_PRESETS: readonly { value: string; label: string }[] = [
  { value: NO_TIME, label: 'No set time' },
  { value: '07:00', label: '7am' },
  { value: '09:00', label: '9am' },
  { value: '12:00', label: 'Noon' },
  { value: '17:00', label: '5pm' },
  { value: '21:00', label: '9pm' },
];

/**
 * The segments to offer, given what is currently chosen.
 *
 * The five presets were the *only* answers, so a routine at 06:30 was
 * unexpressible. Jake: *"on routines it only lets you choose preset times for
 * the notification/scheduling on it. You should be able to pick any time you
 * want in addition to the preset options."*
 *
 * "In addition to" is the shape: the presets stay, because they are one tap
 * and cover most of it, and `Other…` opens a wheel. A custom time becomes its
 * own segment so the control can show it as selected — a `SegmentedControl`
 * whose value is not among its segments renders nothing as chosen, which would
 * read as the time having been forgotten.
 */
function timeChoices(time: CivilTime | null): readonly { value: string; label: string }[] {
  const custom =
    time !== null && !TIME_PRESETS.some((choice) => choice.value === time)
      ? [{ value: time, label: formatCivilTime(time) }]
      : [];
  return [...TIME_PRESETS, ...custom, { value: OTHER_TIME, label: 'Other…' }];
}

interface Props {
  item?: RoutineItem | undefined;
  /** Live chores, for the link picker. */
  chores: readonly Chore[];
  /** Pre-selected when arriving from a chore's sheet. */
  initialLinkedChoreId?: string | null;
  initialTitle?: string | undefined;
  today: CivilDate;
  calendar: CalendarConfig;
  onSubmit: (draft: RoutineDraft) => void;
  onCancel: () => void;
  onDelete?: (() => void) | undefined;
  isSaving?: boolean;
  error?: string | null;
}

export function RoutineForm({
  item,
  chores,
  initialLinkedChoreId = null,
  initialTitle,
  today,
  calendar,
  onSubmit,
  onCancel,
  onDelete,
  isSaving = false,
  error = null,
}: Props) {
  const editing = item !== undefined;

  const [title, setTitle] = useState(item?.title ?? initialTitle ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [icon, setIcon] = useState<IconName | null>(toIconName(item?.icon));
  const [remind, setRemind] = useState(item?.remind ?? false);
  const [linkedChoreId, setLinkedChoreId] = useState<string | null>(
    item?.linkedChoreId ?? initialLinkedChoreId,
  );

  // Default to daily. The full eight rules are free because the engine is
  // shared, but a monthly-by-weekday routine on a daily screen is close to
  // meaningless and the default should not suggest it.
  const [recurrence, setRecurrence] = useState<RecurrenceDraft>(() =>
    draftFromRule(item?.schedule.rule ?? { kind: 'daily', everyNDays: 1 }, today),
  );
  const [startsOn, setStartsOn] = useState<CivilDate>(item?.schedule.startsOn ?? today);

  const [timeOfDay, setTimeOfDay] = useState<CivilTime | null>(item?.timeOfDay ?? null);
  const [bucket, setBucket] = useState<TimeBucket>(item?.bucket ?? 'morning');
  /** Open while the wheel is showing; the segment reads as `Other…` then. */
  const [nagUntilDone, setNagUntilDone] = useState<boolean>(item?.nagUntilDone ?? false);
  const [pickingTime, setPickingTime] = useState(false);
  const [timeDraft, setTimeDraft] = useState<CivilTime>(item?.timeOfDay ?? ('08:00' as CivilTime));

  const schedule: Schedule = useMemo(
    () => ({
      rule: recurrence.rule,
      startsOn: recurrence.rule.kind === 'once' ? recurrence.rule.dueOn : startsOn,
      endsOn: item?.schedule.endsOn ?? null,
      timesOfDay: item?.schedule.timesOfDay ?? [],
    }),
    [recurrence.rule, startsOn, item],
  );

  const trimmed = title.trim();
  // `ROUTINE_TITLE_MAX`, not a literal. The chore form had this same gate
  // hard-coded at 120 while its input allowed 200, so a long name typed fine
  // and then the button silently did nothing.
  const canSave = trimmed.length > 0 && trimmed.length <= ROUTINE_TITLE_MAX && !isSaving;

  /** What a reminder would actually say, so the toggle is not a guess. */
  const remindAt = timeOfDay ?? bucketStart(bucket);
  const remindHint =
    timeOfDay === null
      ? `At ${formatCivilTime(remindAt)}, the start of ${describeBucket(bucket)}.`
      : `At ${formatCivilTime(remindAt)}.`;

  const submit = () => {
    if (!canSave) return;
    onSubmit({
      title: trimmed,
      notes: notes.trim().length === 0 ? null : notes.trim(),
      schedule,
      // Exactly one, matching the database constraint.
      timeOfDay,
      /*
       * Only ever sent for a timed item. A bucket item shares one grouped
       * reminder, so there is no instant to ladder from — and storing `true`
       * there would be a switch the planner silently ignores.
       */
      nagUntilDone: timeOfDay === null ? false : nagUntilDone,
      bucketChoice: timeOfDay === null ? bucket : null,
      icon,
      remind,
      linkedChoreId,
    });
  };

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl, gap: space.xl }}
        keyboardShouldPersistTaps="handled"
        /*
          Inset the scroll view by the keyboard instead of letting it sit on
          top. Without this the fields at the foot of a long form — the ones
          most likely to be typed into last — were covered, and the only way to
          reach them was to dismiss the keyboard first.

          A content inset rather than a `KeyboardAvoidingView`: this form is
          already a scroll view, so the scroller is the thing that should
          shrink, and the wrapper would fight the `SafeAreaView` around it.
          Android resizes the window itself, so this is iOS-only by design.
        */
        automaticallyAdjustKeyboardInsets
      >
        <BackBar label="Cancel" onPress={onCancel} />

        <Txt variant="display" accessibilityRole="header">
          {editing ? 'Edit routine item' : 'New routine item'}
        </Txt>

        {error === null ? null : <ErrorState message={error} />}

        <Field
          label="Name"
          value={title}
          onChangeText={setTitle}
          placeholder="Stretch"
          autoFocus={!editing}
          maxLength={ROUTINE_TITLE_MAX}
        />

        <Field
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          placeholder="Optional"
          multiline
          maxLength={ROUTINE_NOTES_MAX}
        />

        <IconPicker value={icon} onChange={setIcon} />

        <FieldGroup
          label="When in the day"
          hint={
            timeOfDay === null
              ? 'No set time, so it sits with the rest of that part of the day.'
              : 'A time files it into a part of the day on its own.'
          }
        >
          <SegmentedControl
            segments={timeChoices(timeOfDay)}
            value={pickingTime ? OTHER_TIME : (timeOfDay ?? NO_TIME)}
            onChange={(next) => {
              if (next === OTHER_TIME) {
                /*
                 * Seeded from the current time, or 8am when there is none —
                 * opening a wheel on midnight makes every custom time a long
                 * scroll from somewhere nobody meant.
                 */
                setTimeDraft(timeOfDay ?? ('08:00' as CivilTime));
                setPickingTime(true);
                return;
              }
              setPickingTime(false);
              setTimeOfDay(next === NO_TIME ? null : (next as CivilTime));
            }}
            label="Time of day"
            scrollable
          />

          {pickingTime ? (
            <View style={{ alignItems: 'center', gap: space.xs }}>
              <DateTimePicker
                value={toPickerDate(timeDraft)}
                mode="time"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(event, date) => {
                  /*
                   * A dismissal arrives *with* a date, so checking only for a
                   * missing one lets Android's Cancel commit whatever the
                   * dialog happened to be showing. Same defect, same shape, as
                   * the ones fixed in `TimeField` and `SingleTimeField`.
                   */
                  if (event.type === 'dismissed') {
                    setPickingTime(false);
                    return;
                  }
                  if (date === undefined) return;
                  const picked = fromPickerDate(date);
                  setTimeDraft(picked);
                  // Android's dialog reports once and closes itself, so the
                  // choice is committed there rather than on a second tap.
                  if (Platform.OS !== 'ios') {
                    setTimeOfDay(picked);
                    setPickingTime(false);
                  }
                }}
                accessibilityLabel="Pick a time of day"
              />
              {Platform.OS === 'ios' ? (
                <Button
                  label={`Use ${formatCivilTime(timeDraft)}`}
                  variant="secondary"
                  onPress={() => {
                    setTimeOfDay(timeDraft);
                    setPickingTime(false);
                  }}
                />
              ) : null}
            </View>
          ) : null}
        </FieldGroup>

        {/* Only when there is no specific time — a time decides the bucket by
            itself, and offering both would be two controls for one answer. */}
        {timeOfDay === null ? (
          <FieldGroup label="Part of the day">
            <SegmentedControl
              segments={BUCKETS.map((b) => ({ value: b, label: describeBucket(b) }))}
              value={bucket}
              onChange={setBucket}
              label="Part of the day"
            />
          </FieldGroup>
        ) : null}

        <ChoreLinkPicker chores={chores} value={linkedChoreId} onChange={setLinkedChoreId} />

        <RecurrencePicker
          draft={recurrence}
          onChange={setRecurrence}
          today={today}
          weekStartsOn={calendar.weekStartsOn}
        />

        {recurrence.rule.kind === 'once' || recurrence.rule.kind === 'unscheduled' ? null : (
          <FieldGroup label="Starts on" hint="Nothing happens before this date.">
            <DateField
              value={startsOn}
              onChange={setStartsOn}
              today={today}
              label="Start date"
              weekStartsOn={calendar.weekStartsOn}
            />
          </FieldGroup>
        )}

        <FieldGroup label="Remind me" hint={remind ? remindHint : 'Off — this will not buzz.'}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-start' }}>
            <Switch
              value={remind}
              onValueChange={setRemind}
              accessibilityLabel="Remind me about this routine item"
            />
          </View>
        </FieldGroup>

        {/*
          Keep asking, the same switch chores have.

          Shown only for a *timed* item, and only when reminders are on at all.
          An item that names a bucket shares one grouped nudge with everything
          else in that part of the day — there is no instant for a ladder to
          climb from, and laddering a shared notification would keep nagging
          about things already ticked. A switch the planner ignores is worse
          than no switch, so it is not offered rather than offered and
          disabled.
        */}
        {remind && timeOfDay !== null ? (
          <FieldGroup
            label="Keep asking"
            hint={
              nagUntilDone
                ? 'Reminds again at 3, 8, 16, 27 and 40 minutes, with sound, breaking through Focus. Ticking it off stops the rest next time this phone opens the app. Three things a day can do this; iOS limits how many reminders an app may queue.'
                : 'One reminder, at the time above.'
            }
          >
            <View style={{ flexDirection: 'row', justifyContent: 'flex-start' }}>
              <Switch
                value={nagUntilDone}
                onValueChange={setNagUntilDone}
                accessibilityLabel="Keep reminding me until this is done"
              />
            </View>
          </FieldGroup>
        ) : null}

        {recurrence.rule.kind === 'unscheduled' ? null : (
          <FieldGroup label="Next few times">
            <SchedulePreview schedule={schedule} today={today} calendar={calendar} />
          </FieldGroup>
        )}

        <Stack gap={space.sm}>
          <Button
            label={editing ? 'Save changes' : 'Add to my routine'}
            onPress={submit}
            loading={isSaving}
            disabled={!canSave}
          />
          <Button label="Cancel" variant="ghost" onPress={onCancel} />
          {onDelete === undefined ? null : (
            <Button label="Delete" variant="danger" onPress={onDelete} />
          )}
        </Stack>
      </ScrollView>
    </SafeAreaView>
  );
}
