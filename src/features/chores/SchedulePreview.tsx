/**
 * The next few dates a schedule produces.
 *
 * Worth its place for one reason: recurrence rules are easy to state and hard to
 * predict. "The last Friday of every 3rd month" is unambiguous and still nobody
 * can tell you the next three dates. Showing them turns a guess into a check,
 * and it is the same expander the agenda runs, so what it shows is what will
 * happen rather than a separate approximation of it.
 *
 * It is also the debugging tool: a rule that looks right and previews wrong is a
 * bug you can see before saving.
 */

import { useMemo } from 'react';
import { View } from 'react-native';

import { addDays } from '@/core/civil/date';
import type { CalendarConfig, CivilDate } from '@/core/civil/types';
import { expandOccurrences } from '@/core/recurrence/expand';
import type { Schedule } from '@/core/recurrence/types';
import { Txt } from '@/design/components';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { formatDayShort, formatRelativeDay } from '../today/format';

const HOW_MANY = 5;
/** Wide enough to catch a quarterly rule, inside the engine's 400-day cap. */
const LOOKAHEAD_DAYS = 370;

interface Props {
  schedule: Schedule;
  today: CivilDate;
  calendar: CalendarConfig;
}

export function SchedulePreview({ schedule, today, calendar }: Props) {
  const { colors } = useTheme();

  const dates = useMemo(() => {
    if (schedule.rule.kind === 'unscheduled') return [];
    try {
      const occurrences = expandOccurrences('preview', schedule, calendar, {
        start: today,
        end: addDays(today, LOOKAHEAD_DAYS),
      });
      // Floating rules put several slots on one date; the preview answers "when",
      // so it shows each date once.
      const seen = new Set<CivilDate>();
      for (const occ of occurrences) {
        seen.add(occ.dueOn);
        if (seen.size >= HOW_MANY) break;
      }
      return [...seen];
    } catch {
      // A window too wide, or a rule the expander refuses. The form's own
      // validation reports the cause; the preview just declines to guess.
      return [];
    }
  }, [schedule, today, calendar]);

  if (schedule.rule.kind === 'unscheduled') {
    return (
      <Txt variant="small" tone="faint">
        Nothing to preview — it has no dates until you schedule it.
      </Txt>
    );
  }

  if (dates.length === 0) {
    return (
      <Txt variant="small" tone="faint">
        No dates in the next year. Check the start and end dates.
      </Txt>
    );
  }

  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {dates.map((date, i) => (
          <View
            key={date}
            accessibilityLabel={`${i === 0 ? 'Next' : `Then`}: ${formatDayShort(date)}`}
            style={{
              paddingHorizontal: space.sm,
              paddingVertical: 6,
              borderRadius: radius.sm,
              backgroundColor: i === 0 ? colors.text : colors.sunken,
            }}
          >
            <Txt variant="small" style={{ color: i === 0 ? colors.surface : colors.textMuted }}>
              {formatDayShort(date)}
            </Txt>
          </View>
        ))}
      </View>
      <Txt variant="small" tone="faint">
        First one {formatRelativeDay(dates[0] as CivilDate, today).toLowerCase()}.
      </Txt>
    </View>
  );
}
