import { useLocalSearchParams } from 'expo-router';

import { ChoreEditor } from '@/features/chores/ChoreEditor';

export default function EditChoreRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChoreEditor choreId={id ?? null} />;
}
