import { render, screen } from '@testing-library/react-native';

import { Txt } from '@/design/components';
import { ThemeProvider } from '@/design/theme';
import { ReorderableList } from './ReorderableList';

interface Item {
  id: string;
  name: string;
}

const ITEMS: Item[] = [
  { id: 'a', name: 'Kitchen' },
  { id: 'b', name: 'Laundry' },
  { id: 'c', name: 'Outdoors' },
];

async function renderList() {
  const onReorder = jest.fn();
  await render(
    <ThemeProvider>
      <ReorderableList
        items={ITEMS}
        keyOf={(i: Item) => i.id}
        labelOf={(i: Item) => i.name}
        onReorder={onReorder}
        renderItem={(i: Item) => <Txt>{i.name}</Txt>}
      />
    </ThemeProvider>,
  );
  return { onReorder };
}

describe('ReorderableList', () => {
  it('renders every item in order', async () => {
    await renderList();
    for (const item of ITEMS) expect(screen.getByText(item.name)).toBeTruthy();
  });

  it('says how to reorder, and where each row sits', async () => {
    // A drag handle with no announcement is not discoverable by touch or by
    // VoiceOver. The position matters too: "2 of 3" is the only feedback a
    // screen reader user gets that a move worked.
    await renderList();
    expect(screen.getByLabelText('Laundry, 2 of 3. Hold and drag to reorder.')).toBeTruthy();
  });

  describe('the accessible path', () => {
    // Dragging is unusable with VoiceOver, so every row keeps move actions.
    // These are the reorder mechanism a screen reader user actually has, which
    // makes them worth testing even though the gesture is not.
    //
    // Invoked directly rather than through `fireEvent`, because RNTL does not
    // dispatch `accessibilityAction` — verified: the same call reaches the
    // handler when made directly and does nothing through fireEvent. This is
    // exactly the call VoiceOver makes, so the logic under test is real; what
    // is not covered is the wiring between the platform and the prop.
    it('moves a row down and reports the whole new order', async () => {
      const { onReorder } = await renderList();
      screen
        .getByLabelText('Kitchen, 1 of 3. Hold and drag to reorder.')
        .props.onAccessibilityAction({
          nativeEvent: { actionName: 'moveDown' },
        });
      expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c']);
    });

    it('moves a row up', async () => {
      const { onReorder } = await renderList();
      screen
        .getByLabelText('Outdoors, 3 of 3. Hold and drag to reorder.')
        .props.onAccessibilityAction({
          nativeEvent: { actionName: 'moveUp' },
        });
      expect(onReorder).toHaveBeenCalledWith(['a', 'c', 'b']);
    });

    it('does nothing at the ends, rather than dropping an item off the list', async () => {
      const { onReorder } = await renderList();
      screen
        .getByLabelText('Kitchen, 1 of 3. Hold and drag to reorder.')
        .props.onAccessibilityAction({
          nativeEvent: { actionName: 'moveUp' },
        });
      screen
        .getByLabelText('Outdoors, 3 of 3. Hold and drag to reorder.')
        .props.onAccessibilityAction({
          nativeEvent: { actionName: 'moveDown' },
        });
      expect(onReorder).not.toHaveBeenCalled();
    });
  });

  describe('the drop flicker', () => {
    // Reported from the device: on release the row showed the *old* content
    // for a frame, then the new. Cause: the parent's optimistic update is
    // async (onMutate awaits cancelQueries), so `items` still holds the old
    // order for a moment after release, and syncing that prop stomped the
    // correct local order.
    it('ignores a stale items prop until the parent catches up', async () => {
      const onReorder = jest.fn();
      const view = await render(
        <ThemeProvider>
          <ReorderableList
            items={ITEMS}
            keyOf={(i: Item) => i.id}
            labelOf={(i: Item) => i.name}
            onReorder={onReorder}
            renderItem={(i: Item) => <Txt>{i.name}</Txt>}
          />
        </ThemeProvider>,
      );

      screen
        .getByLabelText('Kitchen, 1 of 3. Hold and drag to reorder.')
        .props.onAccessibilityAction({ nativeEvent: { actionName: 'moveDown' } });
      expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c']);

      // The stale render the optimistic update has not reached yet.
      //
      // A *new* array with the old contents, because that is what the parent
      // produces on every render. Passing `ITEMS` itself left the effect's
      // dependency unchanged, so the path under test never ran and this test
      // passed with the fix removed.
      await view.rerender(
        <ThemeProvider>
          <ReorderableList
            items={[...ITEMS]}
            keyOf={(i: Item) => i.id}
            labelOf={(i: Item) => i.name}
            onReorder={onReorder}
            renderItem={(i: Item) => <Txt>{i.name}</Txt>}
          />
        </ThemeProvider>,
      );

      // Laundry must still be first. Before the fix it snapped back to Kitchen.
      expect(screen.getByLabelText('Laundry, 1 of 3. Hold and drag to reorder.')).toBeTruthy();
    });

    it('accepts the props again once they match what was requested', async () => {
      const onReorder = jest.fn();
      const reordered = [ITEMS[1]!, ITEMS[0]!, ITEMS[2]!];
      const view = await render(
        <ThemeProvider>
          <ReorderableList
            items={ITEMS}
            keyOf={(i: Item) => i.id}
            labelOf={(i: Item) => i.name}
            onReorder={onReorder}
            renderItem={(i: Item) => <Txt>{i.name}</Txt>}
          />
        </ThemeProvider>,
      );

      screen
        .getByLabelText('Kitchen, 1 of 3. Hold and drag to reorder.')
        .props.onAccessibilityAction({ nativeEvent: { actionName: 'moveDown' } });

      await view.rerender(
        <ThemeProvider>
          <ReorderableList
            items={reordered}
            keyOf={(i: Item) => i.id}
            labelOf={(i: Item) => i.name}
            onReorder={onReorder}
            renderItem={(i: Item) => <Txt>{i.name}</Txt>}
          />
        </ThemeProvider>,
      );

      // Having caught up, a later change from elsewhere must land — otherwise
      // the guard would freeze the list against the other person's edits.
      await view.rerender(
        <ThemeProvider>
          <ReorderableList
            items={[ITEMS[2]!, ITEMS[1]!, ITEMS[0]!]}
            keyOf={(i: Item) => i.id}
            labelOf={(i: Item) => i.name}
            onReorder={onReorder}
            renderItem={(i: Item) => <Txt>{i.name}</Txt>}
          />
        </ThemeProvider>,
      );
      expect(screen.getByLabelText('Outdoors, 1 of 3. Hold and drag to reorder.')).toBeTruthy();
    });
  });
});
