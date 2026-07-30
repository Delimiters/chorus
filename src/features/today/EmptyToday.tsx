/**
 * Nothing left to do.
 *
 * The best day in a chore app is the one with nothing on it, so this should read
 * as an achievement rather than a blank. It gets the largest type on the screen
 * and, where possible, credits whoever cleared it.
 */

import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import type { AgendaItem } from '@/core/occurrence/agenda';
import { Stack, Txt } from '@/design/components';
import { useTheme } from '@/design/theme';
import { space } from '@/design/tokens';

/** The app's mark: two rings overlapping — separate people, shared middle. */
function Mark() {
  const { colors } = useTheme();
  return (
    <Svg width={64} height={44} viewBox="0 0 60 40" accessibilityRole="image">
      <Circle cx={22} cy={20} r={14} stroke={colors.inkA} strokeWidth={2} fill="none" />
      <Circle cx={38} cy={20} r={14} stroke={colors.inkB} strokeWidth={2} fill="none" />
    </Svg>
  );
}

interface Props {
  done: readonly AgendaItem[];
  byMember: ReadonlyMap<string, { name: string; ink: string }>;
  userId: string | null;
}

export function EmptyToday({ done, byMember, userId }: Props) {
  /**
   * Credit where it's due.
   *
   * If somebody else cleared the list, say so — that is the single most
   * worthwhile sentence this screen can show, and it is the thing the app exists
   * to make visible.
   */
  const byOthers = done.filter((d) => d.completedBy !== null && d.completedBy !== userId);
  const firstOther = byOthers[0];
  const otherName =
    firstOther?.completedBy != null ? byMember.get(firstOther.completedBy)?.name : undefined;

  const subtitle =
    otherName !== undefined
      ? byOthers.length === 1
        ? `${otherName} did ${firstOther?.choreTitle.toLowerCase()}.`
        : `${otherName} and others cleared the list.`
      : done.length > 0
        ? 'You cleared the list.'
        : 'Nothing due. Enjoy it.';

  return (
    <View
      style={{ alignItems: 'center', paddingVertical: space.xxxl, paddingHorizontal: space.lg }}
    >
      <Stack gap={space.md} style={{ alignItems: 'center' }}>
        <Mark />
        <Txt variant="title" accessibilityRole="header">
          All clear
        </Txt>
        <Txt tone="muted" style={{ textAlign: 'center' }}>
          {subtitle}
        </Txt>
      </Stack>
    </View>
  );
}
