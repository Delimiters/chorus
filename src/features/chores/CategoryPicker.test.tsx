import { render, screen, userEvent } from '@testing-library/react-native';

import type { Category } from '@/data/api/categories';
import { ThemeProvider } from '@/design/theme';
import { CategoryAndPriorityPicker } from './CategoryPicker';

const CATEGORIES: readonly Category[] = [
  { id: 'c-kitchen', name: 'Kitchen', ink: 'teal', position: 0 },
  { id: 'c-laundry', name: 'Laundry', ink: null, position: 1 },
];

async function renderPicker(
  over: Partial<React.ComponentProps<typeof CategoryAndPriorityPicker>> = {},
) {
  const onChangeCategory = jest.fn();
  const onChangePriority = jest.fn();
  await render(
    <ThemeProvider>
      <CategoryAndPriorityPicker
        categories={CATEGORIES}
        categoryId={null}
        onChangeCategory={onChangeCategory}
        priority="normal"
        onChangePriority={onChangePriority}
        {...over}
      />
    </ThemeProvider>,
  );
  return { onChangeCategory, onChangePriority };
}

describe('CategoryAndPriorityPicker', () => {
  it('offers every category plus Other', async () => {
    await renderPicker();
    expect(screen.getByLabelText('Category: Kitchen')).toBeTruthy();
    expect(screen.getByLabelText('Category: Laundry')).toBeTruthy();
    expect(screen.getByLabelText('Category: Other')).toBeTruthy();
  });

  it('reports null when Other is chosen, because Other is the absence of a category', async () => {
    // The assertion that matters: Other must not send some sentinel id the
    // database would reject as a foreign key.
    const { onChangeCategory } = await renderPicker({ categoryId: 'c-kitchen' });
    await userEvent.press(screen.getByLabelText('Category: Other'));
    expect(onChangeCategory).toHaveBeenCalledWith(null);
  });

  it('reports the id when a real category is chosen', async () => {
    const { onChangeCategory } = await renderPicker();
    await userEvent.press(screen.getByLabelText('Category: Kitchen'));
    expect(onChangeCategory).toHaveBeenCalledWith('c-kitchen');
  });

  it('marks the current category selected, and only that one', async () => {
    await renderPicker({ categoryId: 'c-laundry' });
    expect(screen.getByRole('radio', { name: 'Category: Laundry', selected: true })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Category: Kitchen', selected: false })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Category: Other', selected: false })).toBeTruthy();
  });

  it('offers all three priorities and reports the chosen one', async () => {
    const { onChangePriority } = await renderPicker();
    for (const label of ['Crucial', 'Normal', 'Minor']) {
      expect(screen.getByLabelText(`Priority: ${label}`)).toBeTruthy();
    }
    await userEvent.press(screen.getByLabelText('Priority: Crucial'));
    expect(onChangePriority).toHaveBeenCalledWith('crucial');
  });

  it('still offers Other when the household has no categories at all', async () => {
    // Otherwise a fresh household sees an empty control and no way to proceed.
    await renderPicker({ categories: [] });
    expect(screen.getByLabelText('Category: Other')).toBeTruthy();
  });
});
