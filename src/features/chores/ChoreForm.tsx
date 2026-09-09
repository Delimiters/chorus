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
 *
 * ── Order, and why it is not alphabetical or historical ───────────────────
 *
 * Category comes before Icon. Filing a chore under a category adopts that
 * category's icon, so with the icon first the auto-choice happened off-screen
 * above you and the picker you had just used silently changed. Jake: *"since
 * icon gets auto selected by category, you should be able to pick the category
 * first so it can auto select the icon and you can keep scrolling if you're
 * good with the default."*
 *
 * ── Why the scroll view is a `FormScroll` ─────────────────────────────────
 *
 * Half the controls here open a panel inline and close it once you have chosen.
 * A plain `ScrollView` keeps its offset through the shrink, which drops you
 * further down the form than where you were working. Each such section is
 * wrapped in an anchor and hands the picker an `onCollapse`. See
 * src/features/common/FormScroll.tsx.
 */

import { useMemo, useState } from 'react';
import { Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CalendarConfig, CivilDate, CivilTime } from '@/core/civil/types';
import type { Schedule } from '@/core/recurrence/types';
import type { Assignment } from '@/core/rotation/types';
import type { Chore, ChoreDraft } from '@/data/api/chores';
import { BackBar, Button, ErrorState, Field, Stack, Txt } from '@/design/components';
import { FieldGroup, SegmentedControl } from '@/design/controls';
import { DEFAULT_PRIORITY, type Priority } from '@/core/chore/priority';
import { useReminderPolicy } from '@/stores/reminderStore';
import { describeSilence, whyNoReminder } from '@/core/notify/silence';
import { useCategoryList, useCreateCategory } from '@/data/hooks/useCategories';
import { useTheme } from '@/design/theme';
import { formatTimestampDay } from '@/features/common/format';
import { space } from '@/design/tokens';
import { AssignmentPicker, type PickerMember } from './AssignmentPicker';
import { SubtaskEditor, type SubtaskDraft } from './SubtaskEditor';
import { DateField } from '@/features/common/DateField';
import { CategoryPicker, PriorityPicker, type NewCategoryDraft } from './CategoryPicker';
import { FormScroll, useAnchor, useFormScroll } from '@/features/common/FormScroll';
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
  /**
   * Seeds the title when creating.
   *
   * The plan's picker offers `Create "water plants"` when a search matches
   * nothing, and arriving at an empty form would throw away the words that got
   * you here. Ignored when editing, where the chore's own title wins.
   */
  initialTitle?: string | undefined;
  /** The chore's existing steps, in order. Empty when creating. */
  subtasks?: readonly SubtaskDraft[];
  members: readonly PickerMember[];
  userId: string | null;
  today: CivilDate;
  calendar: CalendarConfig;
  onSubmit: (draft: ChoreDraft) => void;
  onCancel: () => void;
  /**
   * Put it on today's plan as soon as it is saved.
   *
   * New chores only — an existing one is already wherever it belongs, and a
   * toggle on the edit form would read as "move this", which it is not.
   */
  planToday?: boolean;
  onPlanTodayChange?: (planToday: boolean) => void;
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
  initialTitle,
  subtasks = [],
  members,
  userId,
  today,
  calendar,
  onSubmit,
  onCancel,
  planToday,
  onPlanTodayChange,
  onArchive,
  isSaving = false,
  error = null,
}: Props) {
  const { colors } = useTheme();
  const editing = chore !== undefined;

  const [title, setTitle] = useState(chore?.title ?? initialTitle ?? '');
  const [notes, setNotes] = useState(chore?.notes ?? '');
  const [recurrence, setRecurrence] = useState<RecurrenceDraft>(() =>
    draftFromRule(chore?.schedule.rule ?? { kind: 'weekly', everyNWeeks: 1, weekdays: [] }, today),
  );
  const [assignment, setAssignment] = useState<Assignment>(chore?.assignment ?? { kind: 'anyone' });
  const [categoryId, setCategoryId] = useState<string | null>(chore?.categoryId ?? null);
  const [priority, setPriority] = useState<Priority>(chore?.priority ?? DEFAULT_PRIORITY);
  const [icon, setIcon] = useState<IconName | null>(toIconName(chore?.icon));
  /*
   * Kept as a boolean and written out as an id.
   *
   * "Private" is a fact about you, not a person you nominate: there is no
   * screen anywhere that offers making a chore private *to somebody else*, and
   * the column stores an id only because a boolean would need `created_by` to
   * be trustworthy, which it is not.
   */
  const [steps, setSteps] = useState<readonly SubtaskDraft[]>(subtasks);
  const [isPrivate, setIsPrivate] = useState<boolean>(
    chore?.privateTo !== null && chore?.privateTo !== undefined,
  );

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

  /**
   * A category being written here, created only when the chore is saved.
   *
   * Null when the fields are closed. It deliberately does not exist until then:
   * the old "Add category" button created it on the spot, so abandoning the
   * chore left an orphan category behind in the house.
   */
  const [newCategory, setNewCategory] = useState<NewCategoryDraft | null>(null);

  /**
   * A category this form has already created, under the name it was created as.
   *
   * The chore save is a second write and can fail on its own — a network blip,
   * an RLS refusal. Without this, pressing Save again re-ran the creation, hit
   * the `unique (household_id, name)` constraint, and rejected: the chore
   * became **unsaveable from this form**, with the only clue a duplicate-name
   * error rendered several hundred points above the button that was pressed.
   *
   * Keyed on the **name**, because the name is what collides. The first version
   * forgot the id on any edit to the draft at all, which meant tapping a colour
   * swatch after a failed save re-armed the very bug this exists to remove.
   * Changing the name still creates a fresh one, so a chore is never filed
   * under a name that is no longer typed.
   */
  const [created, setCreated] = useState<{ name: string; id: string } | null>(null);

  /*
   * One anchor per section that grows and shrinks. The icon grid is the one
   * Jake reported; the others are the same control shape and were the "few
   * places" he also mentioned.
   */
  const scroll = useFormScroll();
  const categoryAnchor = useAnchor(scroll);
  const iconAnchor = useAnchor(scroll);
  const startsOnAnchor = useAnchor(scroll);
  const remindAnchor = useAnchor(scroll);
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
  const canSave =
    trimmed.length > 0 && trimmed.length <= 120 && !isSaving && !createCategory.isPending;

  const submit = () => {
    if (!canSave) return;

    /*
     * A drafted category is created here, and the chore is filed under it.
     *
     * Sequenced rather than parallel: the chore needs the new id, so there is
     * nothing to overlap. If the creation fails — a duplicate name is the
     * common one — the error renders under the fields and the chore is not
     * saved, which leaves everything typed still on screen to correct.
     */
    const drafted = newCategory === null ? null : newCategory.name.trim();
    if (drafted !== null && drafted.length > 0) {
      // Already created on an earlier press whose chore save then failed.
      if (created !== null && created.name === drafted) {
        save(created.id);
        return;
      }

      void createCategory
        .mutateAsync({
          name: drafted,
          ink: newCategory?.ink ?? null,
          icon: newCategory?.icon ?? null,
        })
        .then((id) => {
          setCreated({ name: drafted, id });
          save(id);
        })
        .catch(() => {
          // Surfaced by `createError` below. Swallowed so an unhandled
          // rejection does not take the screen down with it.
        });
      return;
    }

    save(categoryId);
  };

  const save = (chosenCategoryId: string | null) => {
    onSubmit({
      title: trimmed,
      notes: notes.trim().length === 0 ? null : notes.trim(),
      schedule,
      assignment,
      categoryId: chosenCategoryId,
      priority,
      icon,
      privateTo: isPrivate ? userId : null,
      // Blank rows are how a half-typed step looks; they are not steps.
      subtasks: steps
        .filter((step) => step.title.trim().length > 0)
        .map((step) => ({
          ...(step.id === undefined ? {} : { id: step.id }),
          title: step.title.trim(),
        })),
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <FormScroll
        scroll={scroll}
        testID="chore-form-scroll"
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

        {/* Category first: it picks the icon for you, and the icon picker is
            directly below so you can see that happen and keep going. */}
        <View testID="section:category" {...categoryAnchor.anchorProps}>
          <CategoryPicker
            categories={categories}
            categoryId={categoryId}
            onChangeCategory={(id) => {
              // Choosing an existing one abandons anything half-written. That
              // tears the draft block down, so the form has to come back to
              // this section the same way cancelling it does.
              if (newCategory !== null) categoryAnchor.returnHere();
              setNewCategory(null);
              chooseCategory(id);
            }}
            draft={newCategory}
            onChangeDraft={setNewCategory}
            createError={(createCategory.error as Error | null)?.message ?? null}
            onCollapse={categoryAnchor.returnHere}
          />
        </View>

        <View testID="section:icon" {...iconAnchor.anchorProps}>
          <IconPicker value={icon} onChange={setIcon} onCollapse={iconAnchor.returnHere} />
        </View>

        <PriorityPicker priority={priority} onChangePriority={setPriority} />

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
          <View testID="section:starts-on" {...startsOnAnchor.anchorProps}>
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
                onCollapse={startsOnAnchor.returnHere}
                today={today}
                label="Start date"
                weekStartsOn={calendar.weekStartsOn}
              />
            </FieldGroup>
          </View>
        )}

        {/* A Someday chore produces no occurrences, so there is nothing to
            remind about and a time control would do nothing. */}
        {recurrence.rule.kind === 'unscheduled' ? null : (
          <View testID="section:remind" {...remindAnchor.anchorProps}>
            <TimeField
              value={timesOfDay}
              onChange={setTimesOfDay}
              defaultTime={reminderDefaultTime}
              silence={reminderSilence === null ? null : describeSilence(reminderSilence)}
              onCollapse={remindAnchor.returnHere}
            />
          </View>
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

        {/*
          Below the assignment, because it answers a related question — who is
          this chore's business — and above the buttons, because it must be
          seen before saving rather than discovered afterwards.

          Only offered when signed in: without an id there is nobody to keep it
          private *to*, and a switch that silently did nothing would be worse
          than its absence.
        */}
        <SubtaskEditor value={steps} onChange={setSteps} />

        {userId === null ? null : (
          <FieldGroup
            label="Private"
            hint={
              isPrivate
                ? 'Only you can see this chore, and only you can see when it is done.'
                : 'Everyone in the household can see this chore.'
            }
          >
            <SegmentedControl
              segments={[
                { value: 'shared' as const, label: 'Shared' },
                { value: 'private' as const, label: 'Only me' },
              ]}
              value={isPrivate ? 'private' : 'shared'}
              onChange={(value: string) => setIsPrivate(value === 'private')}
              label="Who can see this chore"
            />
          </FieldGroup>
        )}

        {/*
          Adding something while looking at today almost always means doing it
          today, so this is on by default. If the chore turns out to have no
          occurrence today — one scheduled for next month — the plan simply
          finds nothing to claim and the switch costs nothing.
        */}
        {onPlanTodayChange === undefined ? null : (
          <FieldGroup label="When you save">
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: space.md,
              }}
            >
              <Txt variant="small" tone="muted" style={{ flex: 1, minWidth: 0 }}>
                Put it on today&apos;s plan
              </Txt>
              <Switch
                value={planToday ?? false}
                onValueChange={onPlanTodayChange}
                accessibilityLabel="Put it on today's plan"
              />
            </View>
          </FieldGroup>
        )}

        <Stack gap={space.sm}>
          <Button
            label={editing ? 'Save changes' : 'Add chore'}
            onPress={submit}
            disabled={!canSave}
            loading={isSaving || createCategory.isPending}
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
      </FormScroll>
    </SafeAreaView>
  );
}
