import { useLocalSearchParams } from 'expo-router';

import { RoutineEditor } from '@/features/routines/RoutineEditor';

export default function NewRoutineRoute() {
  // Set when arriving from a chore's sheet, so the link and name are prefilled.
  const { choreId, title } = useLocalSearchParams<{ choreId?: string; title?: string }>();
  return (
    <RoutineEditor
      itemId={null}
      initialLinkedChoreId={choreId ?? null}
      {...(title === undefined ? {} : { initialTitle: title })}
    />
  );
}
