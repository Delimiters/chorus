/**
 * The Today tab: chores or routines, remembered per device.
 *
 * The choice lives here rather than in either feature because a route *is* the
 * composition point — `features/routines` importing `features/today` would be
 * one feature reaching into another, which the lint rule forbids and which is
 * how `features/chores` quietly became a library.
 *
 * The two screens each render their own switch at the top rather than sharing a
 * wrapper, so neither has to give up its own scroll view or safe-area handling.
 */

import { useRouter } from 'expo-router';

import { useHousehold, useMembers } from '@/data/hooks/useHousehold';
import { useToday } from '@/data/today';
import { RoutinesView } from '@/features/routines/RoutinesView';
import { TodayScreen } from '@/features/today/TodayScreen';
import { useRoutinePreference } from '@/stores/routineStore';
import { useUserId } from '@/stores/sessionStore';

export default function TodayTab() {
  const preference = useRoutinePreference();
  const router = useRouter();
  const userId = useUserId();
  const members = useMembers();
  const household = useHousehold();
  const today = useToday(household.data?.timeZone ?? 'UTC');

  if (preference.todayMode === 'chores') return <TodayScreen />;

  const myInk = members.data?.find((m) => m.userId === userId)?.accent ?? null;

  return (
    <RoutinesView
      today={today}
      myInk={myInk}
      onAdd={() => router.push('/routine/new')}
      onOpen={(item) => router.push(`/routine/${item.itemId}`)}
    />
  );
}
