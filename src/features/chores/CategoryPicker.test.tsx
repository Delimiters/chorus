import { render, screen, userEvent } from '@testing-library/react-native';

import type { Category } from '@/data/api/categories';
import { ThemeProvider } from '@/design/theme';
import { CategoryPicker, PriorityPicker, type NewCategoryDraft } from './CategoryPicker';

const CATEGORIES: readonly Category[] = [
  { id: 'c-kitchen', name: 'Kitchen', ink: 'teal', icon: 'silverware-fork-knife', position: 0 },
  { id: 'c-laundry', name: 'Laundry', ink: null, icon: null, position: 1 },
];

async function renderPicker(over: Partial<React.ComponentProps<typeof CategoryPicker>> = {}) {
  const onChangeCategory = jest.fn();
  const onChangeDraft = jest.fn();
  await render(
    <ThemeProvider>
      <CategoryPicker
        categories={CATEGORIES}
        categoryId={null}
        onChangeCategory={onChangeCategory}
        draft={null}
        onChangeDraft={onChangeDraft}
        {...over}
      />
    </ThemeProvider>,
  );
  return { onChangeCategory, onChangeDraft };
}

const DRAFT: NewCategoryDraft = { name: '', ink: null, icon: null };

describe('CategoryPicker', () => {
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

  it('still offers Other when the household has no categories at all', async () => {
    // Otherwise a fresh household sees an empty control and no way to proceed.
    await renderPicker({ categories: [] });
    expect(screen.getByLabelText('Category: Other')).toBeTruthy();
  });
});

describe('writing a new category', () => {
  it('is reachable even when the household has none yet', async () => {
    // The case that motivated this: a brand-new household filing its first
    // chore should not have to abandon the form to make a category.
    await renderPicker({ categories: [] });
    expect(screen.getByLabelText('Add a category')).toBeTruthy();
  });

  it('opens a draft rather than creating anything', async () => {
    /*
     * The button used to create the category immediately, so abandoning the
     * chore left one behind in the house. Nothing is written until the chore
     * is saved — see ChoreForm.
     */
    const { onChangeDraft } = await renderPicker();
    await userEvent.press(screen.getByLabelText('Add a category'));
    expect(onChangeDraft).toHaveBeenCalledWith({ name: '', ink: null, icon: null });
  });

  it('deselects whatever was chosen, so the save is not ambiguous', async () => {
    const { onChangeCategory } = await renderPicker({ categoryId: 'c-kitchen' });
    await userEvent.press(screen.getByLabelText('Add a category'));
    expect(onChangeCategory).toHaveBeenCalledWith(null);
  });

  it('has no confirm button — the chore form is the save', async () => {
    await renderPicker({ draft: DRAFT });
    expect(screen.queryByText('Add category')).toBeNull();
  });

  it('reports the typed name', async () => {
    const { onChangeDraft } = await renderPicker({ draft: DRAFT });
    await userEvent.type(screen.getByLabelText('New category'), 'G');
    expect(onChangeDraft).toHaveBeenCalledWith({ name: 'G', ink: null, icon: null });
  });

  it('reports a chosen colour without discarding the name', async () => {
    const { onChangeDraft } = await renderPicker({ draft: { ...DRAFT, name: 'Garage' } });
    await userEvent.press(screen.getByLabelText('Colour: Teal'));
    expect(onChangeDraft).toHaveBeenCalledWith({ name: 'Garage', ink: 'teal', icon: null });
  });

  it('reports a chosen icon without discarding the name', async () => {
    // "Choose a category icon", not "Choose an icon": on the chore form this
    // picker sits directly above the chore's own, and two controls with the
    // same name are ambiguous to a screen reader and to this query alike.
    const { onChangeDraft } = await renderPicker({ draft: { ...DRAFT, name: 'Garage' } });
    await userEvent.press(screen.getByRole('button', { name: 'Choose a category icon' }));
    await userEvent.press(screen.getByRole('radio', { name: 'car' }));
    expect(onChangeDraft).toHaveBeenCalledWith({ name: 'Garage', ink: null, icon: 'car' });
  });

  it('closes the draft when cancelled', async () => {
    const { onChangeDraft } = await renderPicker({ draft: DRAFT });
    await userEvent.press(screen.getByLabelText('Cancel new category'));
    expect(onChangeDraft).toHaveBeenCalledWith(null);
  });

  it('shows a creation error rather than swallowing it', async () => {
    await renderPicker({
      draft: DRAFT,
      createError: 'There is already a category with that name.',
    });
    expect(screen.getByText('There is already a category with that name.')).toBeTruthy();
  });
});

describe('PriorityPicker', () => {
  it('offers all three priorities and reports the chosen one', async () => {
    const onChangePriority = jest.fn();
    await render(
      <ThemeProvider>
        <PriorityPicker priority="normal" onChangePriority={onChangePriority} />
      </ThemeProvider>,
    );
    for (const label of ['Crucial', 'Normal', 'Minor']) {
      expect(screen.getByLabelText(`Priority: ${label}`)).toBeTruthy();
    }
    await userEvent.press(screen.getByLabelText('Priority: Crucial'));
    expect(onChangePriority).toHaveBeenCalledWith('crucial');
  });
});
