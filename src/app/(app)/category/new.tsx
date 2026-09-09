// Route wrapper. The screen lives in src/features so its test file is not
// inside the router tree — anything under src/app is treated as a route.
import { CategoryEditor } from '@/features/house/CategoryEditor';

export default function NewCategoryRoute() {
  return <CategoryEditor categoryId={null} />;
}
