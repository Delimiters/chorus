/**
 * Choosing a chore's category and priority.
 *
 * Both are chips rather than a dropdown, because both sets are small and a
 * dropdown hides the options behind a tap. The category set can grow, so it
 * wraps; the priority set is fixed at three and always fits.
 *
 * "Other" is offered as a real-looking option even though it is the *absence*
 * of a category — a null `category_id`. Presenting "no category" as an empty
 * state to opt out of would make the common case feel like a mistake.
 */

import { Pressable, View } from 'react-native';

import { describePriority, PRIORITIES, type Priority } from '@/core/chore/priority';
import { OTHER_TITLE } from '@/core/occurrence/grouping';
import type { Category } from '@/data/api/categories';
import { Txt } from '@/design/components';
import { FieldGroup } from '@/design/controls';
import { inkColor, inkSoft } from '@/design/inks';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';

interface Props {
  categories: readonly Category[];
  categoryId: string | null;
  onChangeCategory: (categoryId: string | null) => void;
  priority: Priority;
  onChangePriority: (priority: Priority) => void;
}

export function CategoryAndPriorityPicker({
  categories,
  categoryId,
  onChangeCategory,
  priority,
  onChangePriority,
}: Props) {
  const { colors, isDark } = useTheme();

  return (
    <View style={{ gap: space.xl }}>
      <FieldGroup
        label="Category"
        hint={
          categories.length === 0
            ? 'Add categories in House → Categories to group your chores.'
            : undefined
        }
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {categories.map((category) => {
            const selected = category.id === categoryId;
            const tint = category.ink === null ? colors.text : inkColor(category.ink, isDark);
            return (
              <Chip
                key={category.id}
                label={category.name}
                selected={selected}
                onPress={() => onChangeCategory(category.id)}
                accessibilityLabel={`Category: ${category.name}`}
                tint={tint}
                wash={category.ink === null ? colors.sunken : inkSoft(category.ink, isDark)}
              />
            );
          })}

          {/* Always last, and always present — it is where a chore lands when
              you do not choose, so it must be reachable to undo a choice. */}
          <Chip
            label={OTHER_TITLE}
            selected={categoryId === null}
            onPress={() => onChangeCategory(null)}
            accessibilityLabel={`Category: ${OTHER_TITLE}`}
            tint={colors.text}
            wash={colors.sunken}
          />
        </View>
      </FieldGroup>

      <FieldGroup label="Priority" hint="Sorts the chore within whatever it is grouped by.">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {PRIORITIES.map((level) => (
            <Chip
              key={level}
              label={describePriority(level)}
              selected={level === priority}
              onPress={() => onChangePriority(level)}
              accessibilityLabel={`Priority: ${describePriority(level)}`}
              tint={colors.text}
              wash={colors.sunken}
            />
          ))}
        </View>
      </FieldGroup>
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
  accessibilityLabel,
  tint,
  wash,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  tint: string;
  wash: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      style={{
        minHeight: 40,
        justifyContent: 'center',
        paddingHorizontal: space.md,
        borderRadius: radius.sm,
        backgroundColor: selected ? tint : wash,
      }}
    >
      <Txt
        variant="small"
        style={{
          color: selected ? colors.surface : colors.textMuted,
          fontWeight: selected ? '700' : '500',
        }}
      >
        {label}
      </Txt>
    </Pressable>
  );
}
