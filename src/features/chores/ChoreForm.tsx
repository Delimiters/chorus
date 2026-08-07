/**
 * Creating and editing a chore.
 *
 * One screen rather than a wizard. A chore is a name, a schedule, and whose job
 * it is — three things, all of which you usually already know when you open the
 * form. Steps would add ceremony to a thirty-second task and make editing one
 * field a tour of the other two.
 *
 * The preview sits directly under the schedule because that is where the doubt
 * is: everything else on this screen says what it does, and a recurrence rule
 * does not.
 */

import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CalendarConfig, CivilDate, CivilTime } from '@/core/civil/types';
import type { Schedule } from '@/core/recurrence/types';
import type { Assignment } from '@/core/rotation/types';
import type { Chore, ChoreDraft } from '@/data/api/chores';
import { BackBar, Button, ErrorState, Field, Stack, Txt } from '@/design/components';
import { FieldGroup } from '@/design/controls';
import { DEFAULT_PRIORITY, type Priority } from '@/core/chore/priority';
import { useReminderPolicy } from '@/stores/reminderStore';
import { useCategoryList, useCreateCategory } from '@/data/hooks/useCategories';
import { useTheme } from '@/design/theme';
import { space } from '@/design/tokens';
import { AssignmentPicker, type PickerMember } from './AssignmentPicker';
import { DateField } from './DateField';
import { CategoryAndPriorityPicker } from './CategoryPicker';
import { TimeField } from './TimeField';
import { RecurrencePicker, draftFromRule, type RecurrenceDraft } from './RecurrencePicker';
import { SchedulePreview } from './SchedulePreview';

interface Props {
  /** Absent when creating. */
  chore?: Chore | undefined;
  members: readonly PickerMember[];
  userId: string | null;
  today: CivilDate;
  calendar: CalendarConfig;
  onSubmit: (draft: ChoreDraft) => void;
  onCancel: () => void;
  onArchive?: (() => void) | undefined;
  isSaving?: boolean;
  error?: string | null;
}

export function ChoreForm({
  chore,
  members,
  userId,
  today,
  calendar,
  onSubmit,
  onCancel,
  onArchive,
  isSaving = false,
  error = null,
}: Props) {
  const { colors } = useTheme();
  const editing = chore !== undefined;

  const [title, setTitle] = useState(chore?.title ?? '');
  const [notes, setNotes] = useState(chore?.notes ?? '');
  const [recurrence, setRecurrence] = useState<RecurrenceDraft>(() =>
    draftFromRule(chore?.schedule.rule ?? { kind: 'weekly', everyNWeeks: 1, weekdays: [] }, today),
  );
  const [assignment, setAssignment] = useState<Assignment>(chore?.assignment ?? { kind: 'anyone' });
  const [categoryId, setCategoryId] = useState<string | null>(chore?.categoryId ?? null);
  const [priority, setPriority] = useState<Priority>(chore?.priority ?? DEFAULT_PRIORITY);
  const categories = useCategoryList();
  // The device default, so the field can name it rather than say "the default".
  const reminderDefaultTime = useReminderPolicy().defaultTime;
  const createCategory = useCreateCategory();

  /**
   * When the chore begins. Editable, and it does real work.
   *
   * It seeds from the chore's own date rather than today, so opening an
   * existing chore to change its name does not re-phase it — moving this shifts
   * every occurrence the rule produces, and for a rotating chore it shifts
   * whose turn each one is, because the turn is measured from here.
   *
   * For a repeating rule it also chooses *which* week or month the cycle falls
   * in: "every other Monday" starting the 3rd and starting the 10th are
   * different chores, and until this field existed the answer was decided by
   * whichever day you happened to be adding it on.
   */
  const [startsOn, setStartsOn] = useState<CivilDate>(chore?.schedule.startsOn ?? today);

  /**
   * When this chore's reminder fires, or null to follow the phone default.
   *
   * The engine has read this since reminders were built; nothing ever wrote it.
   */
  const [timeOfDay, setTimeOfDay] = useState<CivilTime | null>(chore?.schedule.timeOfDay ?? null);

  const schedule: Schedule = useMemo(
    () => ({
      rule: recurrence.rule,
      // A one-time rule carries its own date; the schema normalises `startsOn`
      // to match, so sending today's date here would be quietly overwritten.
      startsOn: recurrence.rule.kind === 'once' ? recurrence.rule.dueOn : startsOn,
      endsOn: chore?.schedule.endsOn ?? null,
      timeOfDay,
    }),
    [recurrence.rule, startsOn, timeOfDay, chore],
  );

  const trimmed = title.trim();
  const canSave = trimmed.length > 0 && trimmed.length <= 120 && !isSaving;

  const submit = () => {
    if (!canSave) return;
    onSubmit({
      title: trimmed,
      notes: notes.trim().length === 0 ? null : notes.trim(),
      schedule,
      assignment,
      categoryId,
      priority,
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl, gap: space.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <BackBar label="Cancel" onPress={onCancel} />

        <Txt variant="display" accessibilityRole="header">
          {editing ? 'Edit chore' : 'New chore'}
        </Txt>

        {error === null ? null : <ErrorState message={error} />}

        <Field
          label="Name"
          value={title}
          onChangeText={setTitle}
          placeholder="Take out the bins"
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

        <CategoryAndPriorityPicker
          categories={categories}
          categoryId={categoryId}
          onChangeCategory={setCategoryId}
          priority={priority}
          onChangePriority={setPriority}
          onCreateCategory={(input) => createCategory.mutateAsync(input)}
          creating={createCategory.isPending}
          createError={(createCategory.error as Error | null)?.message ?? null}
        />

        <RecurrencePicker
          draft={recurrence}
          onChange={setRecurrence}
          today={today}
          weekStartsOn={calendar.weekStartsOn}
        />

        {/*
          Only for rules that repeat. A one-time chore already carries its own
          date in the rule, and a Someday chore has no dates at all — offering a
          start date for either is a control with nothing to control.
        */}
        {recurrence.rule.kind === 'once' || recurrence.rule.kind === 'unscheduled' ? null : (
          <FieldGroup
            label="Starts on"
            hint={
              startsOn === today
                ? 'Leave it on today unless it should begin later.'
                : 'Nothing happens before this date.'
            }
          >
            <DateField
              value={startsOn}
              onChange={setStartsOn}
              today={today}
              label="Start date"
              weekStartsOn={calendar.weekStartsOn}
            />
          </FieldGroup>
        )}

        {/* A Someday chore produces no occurrences, so there is nothing to
            remind about and a time control would do nothing. */}
        {recurrence.rule.kind === 'unscheduled' ? null : (
          <TimeField value={timeOfDay} onChange={setTimeOfDay} defaultTime={reminderDefaultTime} />
        )}

        {/* A Someday chore has no dates, so a "next few times" heading over
            "nothing to preview" is a field asking to be ignored. */}
        {recurrence.rule.kind === 'unscheduled' ? null : (
          <FieldGroup label="Next few times">
            <SchedulePreview schedule={schedule} today={today} calendar={calendar} />
          </FieldGroup>
        )}

        <AssignmentPicker
          value={assignment}
          onChange={setAssignment}
          members={members}
          effectiveFrom={startsOn}
          userId={userId}
          today={today}
          recurs={recurrence.rule.kind !== 'once' && recurrence.rule.kind !== 'unscheduled'}
        />

        <Stack gap={space.sm}>
          <Button
            label={editing ? 'Save changes' : 'Add chore'}
            onPress={submit}
            disabled={!canSave}
            loading={isSaving}
          />
          <Button label="Cancel" onPress={onCancel} variant="ghost" />

          {editing && onArchive ? (
            <View style={{ paddingTop: space.lg, gap: space.xs }}>
              {/* The action reverses on an archived chore, so the words have to
                  as well — this button used to say "Archive this chore" while
                  bringing it back. */}
              <Button
                label={chore.archived ? 'Bring this chore back' : 'Archive this chore'}
                onPress={onArchive}
                variant="ghost"
              />
              <Txt variant="small" tone="faint">
                {chore.archived
                  ? 'It starts appearing again, from its next scheduled date.'
                  : 'It stops appearing, and everything already ticked off stays counted. You can bring it back from the archived list.'}
              </Txt>
            </View>
          ) : null}
        </Stack>
      </ScrollView>
    </SafeAreaView>
  );
}
