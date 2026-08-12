import { useLocalSearchParams } from 'expo-router';

import { RoutineEditor } from '@/features/routines/RoutineEditor';

export default function EditRoutineRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RoutineEditor itemId={id ?? null} />;
}
