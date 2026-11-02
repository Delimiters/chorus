/**
 * Pointing a routine item at a chore.
 *
 * The useful half of "schedule your chores": the chore says *when* it is due,
 * the routine item says *where in your day* you actually do it, and ticking the
 * one ticks the other.
 *
 * Only live chores are offered. A linked chore that is later archived keeps its
 * link — the tick simply finds nothing due and becomes a routine tick — but
 * offering an archived chore in the picker would be inviting that state rather
 * than tolerating it.
 *
 * ## Searchable, because the list is not small
 *
 * Every live chore used to be rendered as a chip. On this household that is
 * **221 of them**, wrapped into a wall above the rest of the form. Jake:
 *
 * > "when linking a routine item to a chore, you just get a gigantic list of
 * > every chore there is. It is very hard to find the right one and just a
 * > terrible design. You should have like a searchable dropdown instead"
 *
 * So: a field you type into, and at most a handful of matches at a time. Once
 * something is linked the search collapses to the choice itself, because a
 * picker that keeps offering alternatives after you have picked is still asking
 * a question you have answered.
 */

import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import type { Chore } from '@/data/api/chores';
import { Field, Txt } from '@/design/components';
import { FieldGroup } from '@/design/controls';
import { useTheme } from '@/design/theme';
import { MIN_TARGET, radius, space } from '@/design/tokens';

interface Props {
  chores: readonly Chore[];
  value: string | null;
  onChange: (choreId: string | null) => void;
}

/**
 * How many matches to show at once.
 *
 * Enough that a two-word query usually contains the answer, few enough that the
 * list never becomes the wall it replaced. Typing one more character is a
 * cheaper way to narrow than scrolling.
 */
const MAX_SHOWN = 6;

export function ChoreLinkPicker({ chores, value, onChange }: Props) {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');

  const live = useMemo(() => chores.filter((c) => !c.archived), [chores]);

  /**
   * Resolved against **every** chore, archived ones included.
   *
   * Only live chores are *offered*, but a link made before the chore was
   * archived is still a link. Looking it up in `live` alone rendered such an
   * item as unlinked — and since Clear only appears once something is found,
   * the link could never be removed from this screen. A picker that cannot
   * undo a state it can reach is a dead end.
   */
  const selected = useMemo(() => chores.find((c) => c.id === value) ?? null, [chores, value]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    /*
     * An empty query shows the first few rather than nothing at all: opening a
     * picker onto a blank space reads as having no options, and somebody with
     * four chores should not have to type to find them.
     */
    const pool = needle === '' ? live : live.filter((c) => c.title.toLowerCase().includes(needle));
    return pool.slice(0, MAX_SHOWN);
  }, [live, query]);

  const hiddenCount = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const total =
      needle === ''
        ? live.length
        : live.filter((c) => c.title.toLowerCase().includes(needle)).length;
    return Math.max(0, total - matches.length);
  }, [live, query, matches.length]);

  const row = (label: string, onPress: () => void, key: string, muted = false) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Link to ${label}`}
      style={{
        minHeight: MIN_TARGET,
        justifyContent: 'center',
        paddingHorizontal: space.md,
        borderRadius: radius.sm,
        backgroundColor: colors.sunken,
      }}
    >
      <Txt variant="small" tone={muted ? 'faint' : 'default'} numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  );

  return (
    <FieldGroup
      label="Linked chore"
      hint={
        selected === null
          ? 'Optional. Ticking a linked item also ticks the chore, when it is due that day.'
          : 'Ticking this also ticks the chore, if it is due today.'
      }
    >
      {selected !== null ? (
        /*
         * The answer, and one way to change it. No search box while something
         * is chosen — the field below would be offering to replace a decision
         * that has already been made, which is how a picker ends up feeling
         * like it did not register the tap.
         */
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View
            style={{
              flex: 1,
              minHeight: MIN_TARGET,
              justifyContent: 'center',
              paddingHorizontal: space.md,
              borderRadius: radius.sm,
              backgroundColor: colors.text,
            }}
          >
            <Txt
              variant="small"
              numberOfLines={1}
              style={{ color: colors.surface, fontWeight: '700' }}
            >
              {/*
                Named as archived when it is. The link still works — ticking
                the item finds nothing due and becomes a routine tick — but a
                chore that no longer exists on any list should not read as a
                live one.
              */}
              {selected.archived ? `${selected.title} (archived)` : selected.title}
            </Txt>
          </View>
          <Pressable
            onPress={() => {
              onChange(null);
              setQuery('');
            }}
            accessibilityRole="button"
            accessibilityLabel="Unlink this chore"
            style={{
              minHeight: MIN_TARGET,
              justifyContent: 'center',
              paddingHorizontal: space.md,
            }}
          >
            <Txt variant="small" tone="muted">
              Clear
            </Txt>
          </Pressable>
        </View>
      ) : live.length === 0 ? (
        <Txt variant="small" tone="faint">
          No chores yet — add one and it can be linked here.
        </Txt>
      ) : (
        <View style={{ gap: space.xs }}>
          <Field
            label="Search chores"
            value={query}
            onChangeText={setQuery}
            placeholder="Type part of a chore's name"
            autoCorrect={false}
          />

          {matches.length === 0 ? (
            <Txt variant="small" tone="faint">
              {`Nothing matching “${query.trim()}”.`}
            </Txt>
          ) : (
            matches.map((chore) => row(chore.title, () => onChange(chore.id), chore.id))
          )}

          {/*
            Says how much is not shown, so the list reads as the top of
            something rather than as all of it. Without this a query matching
            forty chores looks like a query matching six.
          */}
          {hiddenCount === 0 ? null : (
            <Txt variant="small" tone="faint">
              {hiddenCount === 1
                ? '1 more — keep typing to narrow it down.'
                : `${String(hiddenCount)} more — keep typing to narrow it down.`}
            </Txt>
          )}
        </View>
      )}
    </FieldGroup>
  );
}
