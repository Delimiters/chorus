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

import { useMemo, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
import { ChoreLinkPicker } from './ChoreLinkPicker';

/** "No particular time" is a real answer, so it needs a real option. */
const NO_TIME = 'none';

const TIME_CHOICES: readonly { value: string; label: string }[] = [
  { value: NO_TIME, label: 'No set time' },
  { value: '07:00', label: '7am' },
  { value: '09:00', label: '9am' },
  { value: '12:00', label: 'Noon' },
  { value: '17:00', label: '5pm' },
  { value: '21:00', label: '9pm' },
];

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
  const canSave = trimmed.length > 0 && trimmed.length <= 120 && !isSaving;

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
          maxLength={120}
          {...(trimmed.length > 120 ? { error: 'That name is too long.' } : {})}
        />

        <Field
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          placeholder="Optional"
          multiline
          maxLength={2000}
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
            segments={TIME_CHOICES}
            value={timeOfDay ?? NO_TIME}
            onChange={(next) => setTimeOfDay(next === NO_TIME ? null : (next as CivilTime))}
            label="Time of day"
            scrollable
          />
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
