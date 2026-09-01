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
import { Pressable, ScrollView, View } from 'react-native';

import type { AgendaItem } from '@/core/occurrence/agenda';
import { Button, Field, Stack, Txt } from '@/design/components';
import { Sheet } from '@/design/Sheet';
import { useTheme } from '@/design/theme';
import { MIN_TARGET, radius, space } from '@/design/tokens';
import { inkColor } from '@/design/inks';

export interface PickerGroup {
  readonly key: string;
  readonly title: string;
  readonly items: readonly AgendaItem[];
}

interface PlanPickerProps {
  readonly open: boolean;
  readonly groups: readonly PickerGroup[];
  readonly categoryFor: (choreId: string) => { name: string; ink: string | null } | null;
  readonly onClose: () => void;
  readonly onAdd: (items: readonly AgendaItem[]) => void;
}

export function PlanPicker({ open, groups, categoryFor, onClose, onAdd }: PlanPickerProps) {
  const { colors, isDark } = useTheme();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState('');

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

      {groups.length === 0 ? (
        <View style={{ paddingVertical: space.xl, alignItems: 'center' }}>
          <Txt variant="small" tone="muted">
            Nothing left to add. Everything outstanding is already on today.
          </Txt>
        </View>
      ) : (
        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: space.md }}>
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
                  const picked = chosen.has(item.occurrenceKey);
                  const category = categoryFor(item.choreId);
                  const rail = category?.ink == null ? null : inkColor(category.ink, isDark);
                  return (
                    <Pressable
                      key={item.occurrenceKey}
                      onPress={() => toggle(item.occurrenceKey)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: picked }}
                      accessibilityLabel={item.choreTitle}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.md,
                        minHeight: MIN_TARGET,
                        paddingHorizontal: space.md,
                        paddingLeft: rail === null ? space.md : space.md + 4,
                        borderRadius: radius.md,
                        backgroundColor: picked ? colors.raised : colors.sunken,
                        opacity: pressed ? 0.7 : 1,
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
