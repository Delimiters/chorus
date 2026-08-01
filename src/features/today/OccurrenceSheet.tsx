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
import { View } from 'react-native';

import { addDays } from '@/core/civil/date';
import type { CivilDate, Weekday } from '@/core/civil/types';
import type { AgendaItem } from '@/core/occurrence/agenda';
import { Txt } from '@/design/components';
import { FieldGroup } from '@/design/controls';
import { Sheet, SheetAction } from '@/design/Sheet';
import { space } from '@/design/tokens';
import { DateField } from '../chores/DateField';
import { formatDayShort } from './format';

interface Props {
  item: AgendaItem | null;
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
  onSkip,
  onReschedule,
  onClearException,
  onEditChore,
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
          <SheetAction
            label={done ? 'Mark as not done' : 'Mark as done'}
            onPress={() => {
              onToggleComplete(item);
              close();
            }}
          />

          {skipped || item.rescheduled ? (
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
