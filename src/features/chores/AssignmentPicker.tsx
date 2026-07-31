/**
 * Choosing who does a chore.
 *
 * Four modes, and the two that look similar are the ones worth distinguishing
 * carefully:
 *
 *   anyone   — one job, either of you does it. Ticking it finishes it.
 *   everyone — one job *each*, done separately. "We each do our own laundry."
 *
 * "Take turns" carries a cadence that is deliberately independent of the chore's
 * own recurrence: bins might go out three times a week while whose-job-it-is
 * changes weekly. Conflating the two is what makes most chore apps unable to
 * express that. See docs/ROTATION.md.
 */

import { View } from 'react-native';

import type { CalendarConfig, CivilDate } from '@/core/civil/types';
import { rosterOn } from '@/core/rotation/assign';
import { rosterChangeDate, rosterIsStale, withRoster } from '@/core/rotation/roster';
import type { Assignment, RotationCadence } from '@/core/rotation/types';
import { Chip } from '@/design/ChoreRow';
import { Button, Txt } from '@/design/components';
import { FieldGroup, OptionRow, SegmentedControl } from '@/design/controls';
import { inkColor } from '@/design/inks';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';

export interface PickerMember {
  readonly userId: string;
  readonly displayName: string;
  readonly accent: string;
}

type Mode = Assignment['kind'];

const CADENCES: readonly { value: RotationCadence['unit']; label: string }[] = [
  { value: 'occurrence', label: 'Each time' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

interface Props {
  value: Assignment;
  onChange: (assignment: Assignment) => void;
  members: readonly PickerMember[];
  /** First date the rotation roster applies from — the chore's start. */
  effectiveFrom: CivilDate;
  userId: string | null;
  today: CivilDate;
  calendar: CalendarConfig;
}

export function AssignmentPicker({
  value,
  onChange,
  members,
  effectiveFrom,
  userId,
  today,
  calendar,
}: Props) {
  const { colors, isDark } = useTheme();

  const roster = members.map((m) => m.userId);
  const currentRoster = rosterOn(value, today);
  const stale = rosterIsStale(value, roster, today);
  const nameOf = (id: string) =>
    id === userId ? 'You' : (members.find((m) => m.userId === id)?.displayName ?? 'Someone');

  /** A small ink square, so a person is identifiable at a glance and by name. */
  const inkMark = (accent: string) => (
    <View
      style={{
        width: 14,
        height: 14,
        borderRadius: 4,
        backgroundColor: inkColor(accent, isDark),
      }}
    />
  );

  const setMode = (mode: Mode) => {
    switch (mode) {
      case 'anyone':
        return onChange({ kind: 'anyone' });
      case 'everyone':
        return onChange({ kind: 'everyone' });
      case 'fixed':
        return onChange({
          kind: 'fixed',
          memberId: value.kind === 'fixed' ? value.memberId : (userId ?? roster[0] ?? ''),
        });
      case 'rotate':
        // `withRoster` appends rather than overwrites, so switching mode back
        // and forth on an existing rotation cannot rewrite who was responsible
        // last month. It used to: this branch rebuilt segment 0 from current
        // membership every time, which was the one in-app route to corrupting
        // the history — three taps away. See src/core/rotation/roster.ts.
        return onChange(
          withRoster({
            assignment: value,
            roster,
            effectiveFrom,
            lastAssigneeId: null,
            nextTurn: 0,
            calendar,
          }),
        );
    }
  };

  return (
    <View style={{ gap: space.lg }}>
      <FieldGroup label="Who does it">
        <View style={{ gap: space.xs }}>
          <OptionRow
            title="Anyone"
            subtitle="One job. Whoever gets to it first ticks it off."
            selected={value.kind === 'anyone'}
            onPress={() => setMode('anyone')}
          />
          <OptionRow
            title="Take turns"
            subtitle="One job, and whose turn it is moves along on its own."
            selected={value.kind === 'rotate'}
            onPress={() => setMode('rotate')}
          />
          <OptionRow
            title="One person"
            subtitle="Always the same person."
            selected={value.kind === 'fixed'}
            onPress={() => setMode('fixed')}
          />
          <OptionRow
            title="Everyone, separately"
            subtitle="One job each, ticked off separately."
            selected={value.kind === 'everyone'}
            onPress={() => setMode('everyone')}
          />
        </View>
      </FieldGroup>

      {value.kind === 'fixed' ? (
        <FieldGroup label="Whose job">
          <View style={{ gap: space.xs }}>
            {members.map((member) => (
              <OptionRow
                key={member.userId}
                title={
                  member.userId === userId ? `${member.displayName} (you)` : member.displayName
                }
                selected={value.memberId === member.userId}
                onPress={() => onChange({ kind: 'fixed', memberId: member.userId })}
                accessory={inkMark(member.accent)}
              />
            ))}
          </View>
        </FieldGroup>
      ) : null}

      {value.kind === 'rotate' ? (
        <>
          <FieldGroup
            label="Turns change"
            hint="Separate from how often the chore happens — bins can go out three times a week while whose job it is changes weekly."
          >
            <SegmentedControl
              segments={CADENCES}
              value={value.cadence.unit}
              onChange={(unit) =>
                onChange({ ...value, cadence: { unit, every: value.cadence.every } })
              }
              label="How often turns change"
            />
          </FieldGroup>

          {stale ? (
            <View
              style={{
                gap: space.xs,
                padding: space.md,
                borderRadius: radius.md,
                backgroundColor: colors.sunken,
              }}
            >
              <Txt variant="small">This rotation does not match who lives here now.</Txt>
              <Txt variant="small" tone="faint">
                Updating it starts from tomorrow. Who did what before that stays as it was.
              </Txt>
              <Button
                label="Use everyone who lives here"
                variant="ghost"
                onPress={() =>
                  onChange(
                    withRoster({
                      assignment: value,
                      roster,
                      effectiveFrom: rosterChangeDate(today),
                      lastAssigneeId: currentRoster[currentRoster.length - 1] ?? null,
                      nextTurn: 0,
                      calendar,
                    }),
                  )
                }
              />
            </View>
          ) : null}

          <FieldGroup label="In this order">
            {/* Order matters and is not alphabetical — it is the order turns go
                in, so it is worth showing rather than leaving implied. */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: space.xs,
                paddingVertical: space.xs,
              }}
            >
              {/* The roster in effect *now*, not `segments[0]`, which is the
                  oldest one — showing that would describe the rotation as it
                  was when the chore was created. */}
              {(currentRoster.length > 0 ? currentRoster : roster).map((id, i) => {
                const member = members.find((m) => m.userId === id);
                return (
                  <View
                    key={id}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}
                  >
                    {i > 0 ? (
                      <Txt variant="small" tone="faint">
                        →
                      </Txt>
                    ) : null}
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingHorizontal: space.sm,
                        paddingVertical: 6,
                        borderRadius: radius.sm,
                        backgroundColor: colors.sunken,
                      }}
                    >
                      {member ? inkMark(member.accent) : null}
                      <Txt variant="small">{nameOf(id)}</Txt>
                    </View>
                  </View>
                );
              })}
            </View>
          </FieldGroup>
        </>
      ) : null}

      {value.kind === 'everyone' ? (
        <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'center' }}>
          <Chip>{`${members.length} checkboxes`}</Chip>
          <Txt variant="small" tone="faint">
            One for each of you, every time it comes round.
          </Txt>
        </View>
      ) : null}
    </View>
  );
}
