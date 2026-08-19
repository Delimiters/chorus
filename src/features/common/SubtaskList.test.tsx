import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Subtask } from '@/data/api/subtasks';
import { ThemeProvider } from '@/design/theme';
import { SubtaskList } from './SubtaskList';

const step = (id: string, title: string): Subtask => ({
  id,
  choreId: 'bathroom',
  title,
  position: 0,
});

const renderList = (subtasks: readonly Subtask[], ticked: readonly string[]) => {
  const onToggle = jest.fn();
  render(
    <ThemeProvider>
      <SubtaskList subtasks={subtasks} ticked={new Set(ticked)} ink="blue" onToggle={onToggle} />
    </ThemeProvider>,
  );
  return { onToggle };
};

describe('the steps inside a chore', () => {
  it('shows nothing at all for a chore without any', () => {
    // Most chores have no steps; the section must not appear for them.
    renderList([], []);
    expect(screen.queryByText(/Steps/)).toBeNull();
  });

  it('counts the ticks for this occurrence', () => {
    renderList([step('a', 'Scrub the bath'), step('b', 'Mop')], ['a']);
    expect(screen.getByText('Steps · 1 of 2')).toBeOnTheScreen();
  });

  it('starts empty for an occurrence with no ticks', () => {
    // A new occurrence has no tick rows. Nothing is written to reset it, so
    // nothing can fail to be written.
    renderList([step('a', 'Scrub the bath')], []);
    expect(screen.getByText('Steps · 0 of 1')).toBeOnTheScreen();
  });

  it('ticks a step', () => {
    const { onToggle } = renderList([step('a', 'Follow up with John')], []);
    fireEvent.press(screen.getByLabelText('Mark Follow up with John done'));

    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), true);
  });

  it('un-ticks one that is done', () => {
    const { onToggle } = renderList([step('a', 'Scrub the bath')], ['a']);
    fireEvent.press(screen.getByLabelText('Mark Scrub the bath not done'));

    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), false);
  });

  it('never marks a step done because its neighbours are', () => {
    // Steps answer for themselves. Nothing here completes them on the chore's
    // behalf, which is what keeps "follow up with John when you're done"
    // honest — that one is ticked after the chore, not by it.
    renderList([step('a', 'Scrub the bath'), step('b', 'Follow up with John')], ['a']);
    expect(screen.getByText('Steps · 1 of 2')).toBeOnTheScreen();
    expect(screen.getByLabelText('Mark Follow up with John done')).toBeOnTheScreen();
  });
});
