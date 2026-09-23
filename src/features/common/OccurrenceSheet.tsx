/**
 * What you can do to one occurrence.
 *
 * The three deviations the data model allows, and nothing else: complete, skip,
 * reschedule. Each writes a row keyed by the occurrence — never a change to the
 * chore — so the rule stays the rule and the deviation stays a deviation. That
 * separation is what makes "what was actually supposed to happen last March"
 * answerable at all. See docs/DATA_MODEL.md.
 *
 * Skip and reschedule are easy to confuse, so the sheet says what each does to
 * the *next* one rather than leaving it to be discovered:
 *
 *   skip       — this one doesn't count. The next one comes as scheduled, and
 *                for a rotation, the turn still advances.
 *   reschedule — this one moves. It keeps its identity, so whose turn it is
 *                does not change with it.
 */

import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { addDays } from '@/core/civil/date';
import type { CivilDate, Weekday } from '@/core/civil/types';
import type { AgendaItem } from '@/core/occurrence/agenda';
import { Txt } from '@/design/components';
import { FieldGroup } from '@/design/controls';
import { Sheet, SheetAction } from '@/design/Sheet';
import { useColors } from '@/design/theme';
import { MIN_TARGET, radius, space } from '@/design/tokens';
import { ChoreDetail } from '@/features/common/ChoreDetail';
import { DateField } from '@/features/common/DateField';
import { formatDayShort } from '@/features/common/format';

/** One shared empty set, so an untouched chore does not allocate per render. */
const EMPTY_TICKS: ReadonlySet<string> = new Set();

interface Props {
  item: AgendaItem | null;
  /**
   * Opens the routine form with this chore pre-linked.
   *
   * Absent when there is nowhere to go — the sheet is shared, and Upcoming does
   * not need to grow a routine entry point to keep working.
   */
  onAddToRoutine?: ((item: AgendaItem) => void) | undefined;
  /** True when this chore is already in the signed-in person's routine. */
  inRoutine?: boolean;
  /**
   * What the chore *is*, as opposed to what you can do to it.
   *
   * Jake: *"when you click a chore and the little menu comes out from the
   * bottom that can really just be like a mini chore view, you see the notes
   * and steps and any details you might want to see at a glance and then below
   * that you have the buttons to flag or edit or what have you."*
   *
   * Passed in rather than fetched here: both callers already assemble exactly
   * this for the row they render, and a sheet that fetched its own would show
   * something subtly different from the row it opened from.
   */
  notes?: string | null;
  subtasks?: readonly { readonly id: string; readonly title: string }[];
  tickedSubtasks?: ReadonlySet<string>;
  onToggleSubtask?: (subtaskId: string, ticked: boolean) => void;
  category?: { readonly name: string; readonly ink: string | null } | null;
  /** "Every Monday", "Twice a week" — the rule in words. */
  scheduleLabel?: string | null;
  /** Whose turn, when it is somebody's in particular. */
  turnLabel?: string | null;
  /**
   * Whose turn this one is, and the people it could be instead.
   *
   * Jake: *"We also need a way to just one tap change who's turn it is. Like
   * oh actually this is going to be my turn this time."*
   *
   * Absent means the control is not offered, and there are two real reasons
   * for that rather than one: an undated chore produces no occurrence for the
   * engine to apply an override to, and an `everyone` chore is one job *each*
   * — reassigning a slot would hand two people the same copy and delete
   * somebody's own. Both would be buttons that write and change nothing.
   */
  turnMembers?: readonly { readonly userId: string; readonly displayName: string }[];
  onSetTurn?: (userId: string | null) => void;
  /** Whether anyone in the house has flagged this chore, and how to change it. */
  flagged?: boolean;
  onToggleFlag?: (choreId: string) => void;
  /**
   * The last failure from one of the actions below, if any.
   *
   * Worth threading through rather than swallowing. Rescheduling was rejected
   * by the database for weeks and the sheet simply closed as though it had
   * worked — the row did not move, nothing said why, and it looked like the app
   * had ignored the tap. A mutation that can fail has to be able to say so.
   */
  error?: string | null;
  today: CivilDate;
  weekStartsOn: Weekday;
  onClose: () => void;
  onToggleComplete: (item: AgendaItem) => void;
  /**
   * Whether this occurrence can be moved or skipped at all.
   *
   * False for an undated chore. Both actions write a `chore_exceptions` row
   * keyed by occurrence, and nothing reads one back for a chore whose rule
   * produces no occurrences — so they would write, change nothing, and report
   * success on the second tap via the unique constraint.
   */
  canSchedule?: boolean;
  onSkip: (item: AgendaItem) => void;
  onReschedule: (item: AgendaItem, movedTo: CivilDate) => void;
  onClearException: (item: AgendaItem) => void;
  onEditChore: (choreId: string) => void;
}

export function OccurrenceSheet({
  item,
  today,
  weekStartsOn,
  error = null,
  onClose,
  onToggleComplete,
  canSchedule = true,
  onSkip,
  onReschedule,
  onClearException,
  onEditChore,
  onAddToRoutine,
  inRoutine = false,
  flagged = false,
  onToggleFlag,
  notes = null,
  subtasks = [],
  tickedSubtasks,
  onToggleSubtask,
  category = null,
  scheduleLabel = null,
  turnLabel = null,
  turnMembers = [],
  onSetTurn,
}: Props) {
  const [moving, setMoving] = useState(false);
  const [movedTo, setMovedTo] = useState<CivilDate>(today);

  const close = () => {
    setMoving(false);
    onClose();
  };

  // Rendered but hidden, so the Modal is mounted and can animate in rather than
  // appearing instantly the first time something is tapped.
  if (item === null) {
    return (
      <Sheet visible={false} onClose={close} title="">
        {null}
      </Sheet>
    );
  }

  const done = item.status === 'completed';
  const skipped = item.status === 'skipped';

  const ticked = tickedSubtasks ?? EMPTY_TICKS;

  return (
    <Sheet
      visible
      onClose={close}
      title={item.choreTitle}
      subtitle={
        item.rescheduled && item.originalDueOn !== null
          ? `Moved to ${formatDayShort(item.dueOn)}, from ${formatDayShort(item.originalDueOn)}`
          : `Due ${formatDayShort(item.dueOn)}`
      }
    >
      {error === null ? null : (
        <View style={{ paddingHorizontal: space.md, paddingBottom: space.xs }}>
          <Txt variant="small" tone="danger">
            {error}
          </Txt>
        </View>
      )}

      {moving ? null : (
        <ChoreDetail
          notes={notes}
          subtasks={subtasks}
          ticked={ticked}
          {...(onToggleSubtask === undefined ? {} : { onToggleSubtask })}
          category={category}
          scheduleLabel={scheduleLabel}
          turnLabel={turnLabel}
        />
      )}

      {moving ? (
        <View style={{ gap: space.md }}>
          <FieldGroup label="Move it to">
            <DateField
              value={movedTo}
              onChange={setMovedTo}
              today={today}
              label="New date"
              weekStartsOn={weekStartsOn}
            />
          </FieldGroup>
          <SheetAction
            label={`Move to ${formatDayShort(movedTo)}`}
            hint="Only this one. Whose turn it is does not change."
            onPress={() => {
              onReschedule(item, movedTo);
              close();
            }}
          />
          <SheetAction label="Back" onPress={() => setMoving(false)} />
        </View>
      ) : (
        <View style={{ gap: 2 }}>
          {/*
            Whose turn, as a row of names rather than a menu.
            
            One tap is the whole request, so anything that opens a picker and
            then asks you to confirm has already lost. The names sit above the
            verbs because this one says what the chore *is* — the rest of the
            sheet does things to it.

            "Rotation" is the way back rather than a separate "clear" action:
            the override is a deviation, and removing it is not an undo so much
            as choosing the original answer again.
          */}
          {onSetTurn === undefined || turnMembers.length < 2 ? null : (
            <View style={{ paddingHorizontal: space.md, paddingBottom: space.sm, gap: space.xs }}>
              <Txt variant="label" tone="faint">
                WHOSE TURN
              </Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
                {turnMembers.map((member) => (
                  <TurnChip
                    key={member.userId}
                    label={member.displayName}
                    selected={turnLabel === member.displayName}
                    onPress={() => onSetTurn(member.userId)}
                  />
                ))}
                <TurnChip
                  label="Rotation"
                  selected={turnLabel === null}
                  onPress={() => onSetTurn(null)}
                />
              </View>
            </View>
          )}

          {onToggleFlag === undefined ? null : (
            <SheetAction
              label={flagged ? 'Unflag it' : 'Flag it'}
              hint={
                flagged
                  ? 'It will stop standing out.'
                  : 'Pins it to the top until it is done or either of you unflags it. Both of you can see it.'
              }
              onPress={() => {
                onToggleFlag(item.choreId);
                close();
              }}
            />
          )}

          <SheetAction
            label={done ? 'Mark as not done' : 'Mark as done'}
            onPress={() => {
              onToggleComplete(item);
              close();
            }}
          />

          {/* Turning a chore into something you actually do at a time of day.
              Already-linked reads differently rather than offering a second
              link, which the partial unique index would refuse anyway. */}
          {onAddToRoutine === undefined ? null : (
            <SheetAction
              label={inRoutine === true ? 'In your routine' : 'Add to my routine'}
              hint={
                inRoutine === true
                  ? 'Open it to change when in the day it sits.'
                  : 'Ticking it there will also tick this chore.'
              }
              onPress={() => {
                onAddToRoutine(item);
                close();
              }}
            />
          )}

          {!canSchedule ? null : skipped || item.rescheduled ? (
            <SheetAction
              label={skipped ? 'Un-skip it' : 'Put it back'}
              hint={
                skipped
                  ? 'It counts again.'
                  : `Back to ${item.originalDueOn === null ? 'its original date' : formatDayShort(item.originalDueOn)}.`
              }
              onPress={() => {
                onClearException(item);
                close();
              }}
            />
          ) : (
            <>
              <SheetAction
                label="Move it"
                hint="Just this one, to another day."
                onPress={() => {
                  setMovedTo(addDays(today, 1));
                  setMoving(true);
                }}
              />
              <SheetAction
                label="Skip it"
                hint="This one doesn't count. The next one comes as scheduled."
                onPress={() => {
                  onSkip(item);
                  close();
                }}
              />
            </>
          )}

          <View style={{ paddingTop: space.sm }}>
            <SheetAction
              label="Edit the chore"
              hint="Changes every time it comes round, not just this one."
              onPress={() => {
                close();
                onEditChore(item.choreId);
              }}
            />
          </View>

          {item.missedBefore > 0 ? (
            <Txt
              variant="small"
              tone="faint"
              style={{ paddingHorizontal: space.md, paddingTop: 4 }}
            >
              {item.missedBefore === 1
                ? 'The last one was missed.'
                : `The last ${item.missedBefore} were missed.`}
            </Txt>
          ) : null}
        </View>
      )}
    </Sheet>
  );
}

/**
 * One name in the "whose turn" row.
 *
 * `MIN_TARGET` as a real minimum height rather than `hitSlop`: a 34pt control
 * with generous slop has been shipped four times in this app and caught four
 * times by `tapTargets.test.ts`, which is why that test names the offenders.
 */
function TurnChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={selected ? `${label}, current turn` : `Give it to ${label}`}
      onPress={onPress}
      style={{
        minHeight: MIN_TARGET,
        justifyContent: 'center',
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? colors.inkA : colors.rule,
        backgroundColor: selected ? colors.inkASoft : 'transparent',
      }}
    >
      <Txt variant="body" {...(selected ? { tone: 'accent' as const } : {})}>
        {label}
      </Txt>
    </Pressable>
  );
}
