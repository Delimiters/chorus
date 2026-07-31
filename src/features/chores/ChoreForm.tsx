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

import type { CalendarConfig, CivilDate } from '@/core/civil/types';
import type { Schedule } from '@/core/recurrence/types';
import type { Assignment } from '@/core/rotation/types';
import type { Chore, ChoreDraft } from '@/data/api/chores';
import { Button, ErrorState, Field, Stack, Txt } from '@/design/components';
import { FieldGroup } from '@/design/controls';
import { useTheme } from '@/design/theme';
import { space } from '@/design/tokens';
import { AssignmentPicker, type PickerMember } from './AssignmentPicker';
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

  /**
   * The start date is the chore's own, not today's, when editing.
   *
   * Moving it would shift every occurrence the rule produces — and for a
   * rotating chore it would also shift whose turn each one is, because the turn
   * is computed from the distance since the roster took effect.
   */
  const startsOn = chore?.schedule.startsOn ?? today;

  const schedule: Schedule = useMemo(
    () => ({
      rule: recurrence.rule,
      // A one-time rule carries its own date; the schema normalises `startsOn`
      // to match, so sending today's date here would be quietly overwritten.
      startsOn: recurrence.rule.kind === 'once' ? recurrence.rule.dueOn : startsOn,
      endsOn: chore?.schedule.endsOn ?? null,
      timeOfDay: chore?.schedule.timeOfDay ?? null,
    }),
    [recurrence.rule, startsOn, chore],
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
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl, gap: space.xl }}
        keyboardShouldPersistTaps="handled"
      >
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

        <RecurrencePicker draft={recurrence} onChange={setRecurrence} today={today} />

        <FieldGroup label="Next few times">
          <SchedulePreview schedule={schedule} today={today} calendar={calendar} />
        </FieldGroup>

        <AssignmentPicker
          value={assignment}
          onChange={setAssignment}
          members={members}
          effectiveFrom={startsOn}
          userId={userId}
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
              <Button label="Archive this chore" onPress={onArchive} variant="ghost" />
              <Txt variant="small" tone="faint">
                It stops appearing, and everything already ticked off stays counted. You can bring
                it back from the archived list.
              </Txt>
            </View>
          ) : null}
        </Stack>
      </ScrollView>
    </SafeAreaView>
  );
}
