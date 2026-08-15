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
import { describeSilence, whyNoReminder } from '@/core/notify/silence';
import { useCategoryList, useCreateCategory } from '@/data/hooks/useCategories';
import { useTheme } from '@/design/theme';
import { formatTimestampDay } from '@/features/common/format';
import { space } from '@/design/tokens';
import { AssignmentPicker, type PickerMember } from './AssignmentPicker';
import { DateField } from '@/features/common/DateField';
import { CategoryAndPriorityPicker } from './CategoryPicker';
import { IconPicker } from '@/features/common/IconPicker';
import { toIconName, type IconName } from '@/design/icons';
import { TimeField } from '@/features/common/TimeField';
import {
  RecurrencePicker,
  draftFromRule,
  type RecurrenceDraft,
} from '@/features/common/RecurrencePicker';
import { SchedulePreview } from '@/features/common/SchedulePreview';

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

/**
 * "Added by Sam on 15 August 2026", degrading gracefully.
 *
 * `created_by` is nullable and a member can leave, so the name is looked up
 * rather than assumed; without one this says when but not who, which is still
 * more than the screen said before.
 */
function creditLine(chore: Chore, members: readonly PickerMember[]): string {
  const when = formatTimestampDay(chore.createdAt);
  const who = members.find((m) => m.userId === chore.createdBy)?.displayName ?? null;
  if (when === null) return who === null ? '' : `Added by ${who}`;
  return who === null ? `Added ${when}` : `Added by ${who} ${when}`;
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
  const [icon, setIcon] = useState<IconName | null>(toIconName(chore?.icon));

  /**
   * Filing a chore under a category adopts that category's icon.
   *
   * Only when the chore has none of its own, or is still wearing the previous
   * category's default — so switching from Kitchen to Laundry updates an icon
   * that was chosen for you, and never overwrites one you picked deliberately.
   * Getting that backwards would silently undo a choice, which is worse than
   * not helping at all.
   */
  const chooseCategory = (nextId: string | null) => {
    const previous = categories.find((c) => c.id === categoryId) ?? null;
    const next = categories.find((c) => c.id === nextId) ?? null;
    const wasAuto = icon !== null && previous !== null && icon === toIconName(previous.icon);
    if (icon === null || wasAuto) setIcon(toIconName(next?.icon ?? null));
    setCategoryId(nextId);
  };
  const categories = useCategoryList();
  // The device default, so the field can name it rather than say "the default".
  const reminderPolicy = useReminderPolicy();
  const reminderDefaultTime = reminderPolicy.defaultTime;

  /**
   * Whether this chore, as currently configured, would ever remind *you*.
   *
   * Recomputed as the assignment changes, so switching from "Anyone" to
   * yourself makes the warning disappear rather than leaving it stale.
   */
  // Signed out is not a state this form is reachable in, and guessing at a
  // reason without knowing who "you" are would be worse than staying quiet.
  const reminderSilence =
    userId === null ? null : whyNoReminder({ assignment, userId, policy: reminderPolicy });
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
  /**
   * When this chore's reminders fire. Empty follows the phone default.
   *
   * A list because one chore can deserve two nudges, and the alternative — a
   * duplicate chore with the same name — would split the completion history
   * that makes the stats meaningful.
   */
  const [timesOfDay, setTimesOfDay] = useState<readonly CivilTime[]>(
    chore?.schedule.timesOfDay ?? [],
  );

  const schedule: Schedule = useMemo(
    () => ({
      rule: recurrence.rule,
      // A one-time rule carries its own date; the schema normalises `startsOn`
      // to match, so sending today's date here would be quietly overwritten.
      startsOn: recurrence.rule.kind === 'once' ? recurrence.rule.dueOn : startsOn,
      endsOn: chore?.schedule.endsOn ?? null,
      timesOfDay,
    }),
    [recurrence.rule, startsOn, timesOfDay, chore],
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
      icon,
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

        <IconPicker value={icon} onChange={setIcon} />

        <CategoryAndPriorityPicker
          categories={categories}
          categoryId={categoryId}
          onChangeCategory={chooseCategory}
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
          <TimeField
            value={timesOfDay}
            onChange={setTimesOfDay}
            defaultTime={reminderDefaultTime}
            silence={reminderSilence === null ? null : describeSilence(reminderSilence)}
          />
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

          {/*
            Who added it, and when.
            
            Read-only, and last on the screen because it is provenance rather
            than a setting. It answers "where did this come from" without a
            trip to the database — which is exactly how the question came up:
            a chore appeared, assigned, and there was no way in the app to see
            that the other person had added it that morning.
          */}
          {editing && chore.createdAt !== null ? (
            <Txt variant="small" tone="faint" style={{ paddingTop: space.lg }}>
              {creditLine(chore, members)}
            </Txt>
          ) : null}
        </Stack>
      </ScrollView>
    </SafeAreaView>
  );
}
