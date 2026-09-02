/**
 * Choosing what today is going to be.
 *
 * Emily's request, close to verbatim: *"i need an area where i can like select
 * chores and add them to TODAY's like schedule"*. So: tap several, one button,
 * a count on the button so you can see what you are committing to before you
 * commit to it.
 *
 * Grouped by **why you might pick it** rather than by category. "Flagged",
 * "Late", "Due today", "Left from yesterday" are answers to "what should be on
 * today"; "Kitchen" and "Pets" are answers to "what kind of thing is this",
 * which is a question for the library. Sorting the picker the way the backlog
 * is sorted would just be the backlog again, with an extra tap.
 */

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import type { AgendaItem } from '@/core/occurrence/agenda';
import { Button, Field, Stack, Txt } from '@/design/components';
import { Sheet } from '@/design/Sheet';
import { useTheme } from '@/design/theme';
import { MIN_TARGET, radius, space } from '@/design/tokens';
import { inkColor } from '@/design/inks';
import { useKeyboardHeight } from '@/design/useKeyboardHeight';

export interface PickerGroup {
  readonly key: string;
  readonly title: string;
  readonly items: readonly AgendaItem[];
  /**
   * Shown, ticked, and not tappable.
   *
   * For work that is already on today. Omitting it silently made "it's not in
   * the list" mean two different things — "you already added it" and "it does
   * not exist" — and Jake hit exactly that: he went looking for a chore to add,
   * could not find it, and reported it missing. It was on his plan.
   */
  readonly locked?: boolean;
}

interface PlanPickerProps {
  readonly open: boolean;
  readonly groups: readonly PickerGroup[];
  readonly categoryFor: (choreId: string) => { name: string; ink: string | null } | null;
  readonly onClose: () => void;
  readonly onAdd: (items: readonly AgendaItem[]) => void;
  /**
   * Make a chore that does not exist yet, without leaving for the library.
   *
   * The floating + used to be the way, but on the plan it sat beside "Add
   * something" — which picks from what you already have — so the most prominent
   * control did the rarer thing. It is gone from this sub-tab, and this is
   * where creating lives instead: one row, one tap, no menu in between.
   *
   * Carries whatever has been typed, so searching for something that turns out
   * not to exist is the start of creating it rather than wasted effort.
   */
  readonly onCreate: (title: string) => void;
}

/**
 * Roughly the sheet's non-list furniture: grabber, title, field, button, inset.
 *
 * Approximate, and on a small enough screen the floor below does have to do the
 * work: a 667pt phone with a 260pt keyboard leaves 107, so the list clamps to
 * 180 and the sheet's own header is what gives. Both phones this runs on are
 * 844pt or taller, where the subtraction never reaches the floor.
 */
const SHEET_CHROME = 300;
/** Never so short that it stops being a list. Scrolls instead. */
const MIN_LIST_HEIGHT = 180;
/** What it was before the keyboard was accounted for, and still the ceiling. */
const MAX_LIST_HEIGHT = 420;

export function PlanPicker({
  open,
  groups,
  categoryFor,
  onClose,
  onAdd,
  onCreate,
}: PlanPickerProps) {
  const { colors, isDark } = useTheme();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState('');

  /*
   * The list has to shrink when the keyboard is up, not just move.
   *
   * At a fixed 420 the options simply sat behind the keyboard: the sheet is
   * bottom-anchored, so the bottom of the list is exactly where the keyboard
   * appears. Searching for something and then being unable to reach the thing
   * you searched for is the worst version of this screen.
   *
   * `SHEET_CHROME` is everything the list shares the sheet with — grabber,
   * title, search field, the Add button and the safe-area inset. Approximate on
   * purpose: it only has to be close enough that the floor below never has to
   * do the work.
   */
  const { height: screenHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();
  const listMaxHeight = Math.max(
    MIN_LIST_HEIGHT,
    Math.min(MAX_LIST_HEIGHT, screenHeight - keyboardHeight - SHEET_CHROME),
  );

  /**
   * Filtered by name, across every group at once.
   *
   * Jake could not find "Water upstairs plants" to add it, and it was there —
   * inside a forty-row "Late" group, in a scroll box. Grouping by why-you-might-
   * pick-it is right for browsing and useless for looking something up, and at
   * this household's size looking something up is the common case.
   *
   * Matching is case- and position-insensitive on the title alone: people
   * search for the word they remember, not the beginning of the name.
   */
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return groups;
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => item.choreTitle.toLowerCase().includes(needle)),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, query]);

  const chosenItems = useMemo(() => {
    // Over `groups`, not `shown`: something ticked and then filtered out of
    // view is still chosen, and losing it when the search narrows would be a
    // silent, infuriating way to drop somebody's selection.
    const out: AgendaItem[] = [];
    for (const group of groups) {
      if (group.locked === true) continue;
      for (const item of group.items) {
        if (chosen.has(item.occurrenceKey)) out.push(item);
      }
    }
    return out;
  }, [groups, chosen]);

  const toggle = (key: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const close = () => {
    setChosen(new Set());
    setQuery('');
    onClose();
  };

  return (
    <Sheet visible={open} onClose={close} title="Add to today">
      {groups.length === 0 ? null : (
        <Field
          label=""
          placeholder="Search"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Search chores to add"
        />
      )}

      {/*
        Pinned above the list rather than scrolling with it.
      
        It is the answer to "it isn't in here", which is a thought you have at
        the bottom of a long list as readily as at the top — a row that has
        scrolled out of sight is not an answer.
      */}
      <Pressable
        onPress={() => {
          const typed = query.trim();
          close();
          onCreate(typed);
        }}
        accessibilityRole="button"
        accessibilityLabel={
          query.trim().length === 0
            ? 'Create a new chore'
            : `Create a new chore called ${query.trim()}`
        }
        style={{
          minHeight: MIN_TARGET,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingHorizontal: space.sm,
          borderRadius: radius.md,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: colors.rule,
        }}
      >
        <Txt variant="bodyStrong" tone="muted">
          +
        </Txt>
        <Txt variant="body" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
          {query.trim().length === 0 ? 'Create a new chore' : `Create “${query.trim()}”`}
        </Txt>
      </Pressable>

      {groups.length === 0 ? (
        <View style={{ paddingVertical: space.md, alignItems: 'center' }}>
          <Txt variant="small" tone="muted">
            Nothing left to add. Everything outstanding is already on today.
          </Txt>
        </View>
      ) : (
        <ScrollView
          style={{ maxHeight: listMaxHeight }}
          contentContainerStyle={{ gap: space.md }}
          /*
           * Without this a tap on a row while the keyboard is up is swallowed
           * dismissing the keyboard, and the row does not toggle — you tap a
           * chore, nothing happens, and you tap again. That is the "you get
           * stuck" part, and it is separate from the list being covered.
           */
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {shown.length === 0 ? (
            <View style={{ paddingVertical: space.xl, alignItems: 'center' }}>
              <Txt variant="small" tone="muted">
                {`Nothing matching "${query.trim()}".`}
              </Txt>
            </View>
          ) : null}

          {shown.map((group) => (
            <View key={group.key} style={{ gap: 2 }}>
              <Txt variant="label" tone="muted" style={{ paddingHorizontal: space.xs }}>
                {`${group.title.toUpperCase()} · ${group.items.length}`}
              </Txt>

              <Stack gap={2}>
                {group.items.map((item) => {
                  const picked = group.locked === true || chosen.has(item.occurrenceKey);
                  const category = categoryFor(item.choreId);
                  const rail = category?.ink == null ? null : inkColor(category.ink, isDark);
                  return (
                    <Pressable
                      key={item.occurrenceKey}
                      onPress={() => {
                        if (group.locked !== true) toggle(item.occurrenceKey);
                      }}
                      disabled={group.locked === true}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: picked, disabled: group.locked === true }}
                      accessibilityLabel={
                        group.locked === true
                          ? `${item.choreTitle}, already on today`
                          : item.choreTitle
                      }
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.md,
                        minHeight: MIN_TARGET,
                        paddingHorizontal: space.md,
                        paddingLeft: rail === null ? space.md : space.md + 4,
                        borderRadius: radius.md,
                        backgroundColor: picked ? colors.raised : colors.sunken,
                        opacity: group.locked === true ? 0.55 : pressed ? 0.7 : 1,
                        overflow: 'hidden',
                      })}
                    >
                      {rail === null ? null : (
                        <View
                          accessibilityElementsHidden
                          importantForAccessibility="no"
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            bottom: 0,
                            width: 4,
                            backgroundColor: rail,
                          }}
                        />
                      )}

                      <View
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: radius.sm,
                          borderWidth: 1.5,
                          borderColor: picked ? colors.overprint : colors.textFaint,
                          backgroundColor: picked ? colors.overprint : 'transparent',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {picked ? (
                          <View
                            style={{
                              width: 9,
                              height: 5,
                              marginTop: -2,
                              borderLeftWidth: 2,
                              borderBottomWidth: 2,
                              borderColor: colors.paper,
                              transform: [{ rotate: '-45deg' }],
                            }}
                          />
                        ) : null}
                      </View>

                      <Txt variant="body" style={{ flex: 1, minWidth: 0 }}>
                        {item.choreTitle}
                      </Txt>

                      {category === null ? null : (
                        <Txt variant="small" tone="faint">
                          {category.name}
                        </Txt>
                      )}
                    </Pressable>
                  );
                })}
              </Stack>
            </View>
          ))}
        </ScrollView>
      )}

      {/*
        The count is on the button, not above it. You are about to commit to a
        number of things, and that number is the whole decision — reading it off
        a heading somewhere else is one glance too many.
      */}
      <View style={{ paddingTop: space.md }}>
        <Button
          label={
            chosenItems.length === 0 ? 'Nothing selected' : `Add ${chosenItems.length} to today`
          }
          disabled={chosenItems.length === 0}
          onPress={() => {
            onAdd(chosenItems);
            close();
          }}
        />
      </View>
    </Sheet>
  );
}
