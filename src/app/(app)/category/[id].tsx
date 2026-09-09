import { useLocalSearchParams } from 'expo-router';

import { CategoryEditor } from '@/features/house/CategoryEditor';

export default function EditCategoryRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CategoryEditor categoryId={id ?? null} />;
}
