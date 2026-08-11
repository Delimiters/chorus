import { render, screen, userEvent } from '@testing-library/react-native';

import type { Category } from '@/data/api/categories';
import { ThemeProvider } from '@/design/theme';
import { CategoryAndPriorityPicker } from './CategoryPicker';

const CATEGORIES: readonly Category[] = [
  { id: 'c-kitchen', name: 'Kitchen', ink: 'teal', icon: 'silverware-fork-knife', position: 0 },
  { id: 'c-laundry', name: 'Laundry', ink: null, icon: null, position: 1 },
];

async function renderPicker(
  over: Partial<React.ComponentProps<typeof CategoryAndPriorityPicker>> = {},
) {
  const onChangeCategory = jest.fn();
  const onChangePriority = jest.fn();
  const onCreateCategory = jest.fn().mockResolvedValue('c-new');
  await render(
    <ThemeProvider>
      <CategoryAndPriorityPicker
        categories={CATEGORIES}
        categoryId={null}
        onChangeCategory={onChangeCategory}
        priority="normal"
        onChangePriority={onChangePriority}
        onCreateCategory={onCreateCategory}
        {...over}
      />
    </ThemeProvider>,
  );
  return { onChangeCategory, onChangePriority, onCreateCategory };
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

  describe('adding a category without leaving the form', () => {
    it('is reachable even when the household has none yet', async () => {
      // The case that motivated this: a brand-new household filing its first
      // chore should not have to abandon the form to make a category.
      await renderPicker({ categories: [] });
      expect(screen.getByLabelText('Add a category')).toBeTruthy();
    });

    it('creates with the typed name and chosen colour', async () => {
      const { onCreateCategory } = await renderPicker();
      await userEvent.press(screen.getByLabelText('Add a category'));
      await userEvent.type(screen.getByLabelText('New category'), 'Garage');
      await userEvent.press(screen.getByLabelText('Colour: Teal'));
      await userEvent.press(screen.getByText('Add category'));
      expect(onCreateCategory).toHaveBeenCalledWith({ name: 'Garage', ink: 'teal', icon: null });
    });

    it('selects the new category, so it does not have to be found and tapped', async () => {
      const { onCreateCategory, onChangeCategory } = await renderPicker();
      onCreateCategory.mockResolvedValue('c-garage');
      await userEvent.press(screen.getByLabelText('Add a category'));
      await userEvent.type(screen.getByLabelText('New category'), 'Garage');
      await userEvent.press(screen.getByText('Add category'));
      expect(onChangeCategory).toHaveBeenCalledWith('c-garage');
    });

    it('creates with no colour when none is chosen', async () => {
      const { onCreateCategory } = await renderPicker();
      await userEvent.press(screen.getByLabelText('Add a category'));
      await userEvent.type(screen.getByLabelText('New category'), 'Garage');
      await userEvent.press(screen.getByText('Add category'));
      expect(onCreateCategory).toHaveBeenCalledWith({ name: 'Garage', ink: null, icon: null });
    });

    it('shows a creation error rather than swallowing it', async () => {
      await renderPicker({ createError: 'There is already a category with that name.' });
      await userEvent.press(screen.getByLabelText('Add a category'));
      expect(screen.getByText('There is already a category with that name.')).toBeTruthy();
    });
  });

  it('can give a new category a default icon without leaving the form', async () => {
    const { onCreateCategory } = await renderPicker();
    await userEvent.press(screen.getByLabelText('Add a category'));
    await userEvent.type(screen.getByLabelText('New category'), 'Garage');
    await userEvent.press(screen.getByRole('button', { name: 'Choose an icon' }));
    await userEvent.press(screen.getByRole('radio', { name: 'car' }));
    await userEvent.press(screen.getByText('Add category'));
    expect(onCreateCategory).toHaveBeenCalledWith({ name: 'Garage', ink: null, icon: 'car' });
  });

  it('still offers Other when the household has no categories at all', async () => {
    // Otherwise a fresh household sees an empty control and no way to proceed.
    await renderPicker({ categories: [] });
    expect(screen.getByLabelText('Category: Other')).toBeTruthy();
  });
});
