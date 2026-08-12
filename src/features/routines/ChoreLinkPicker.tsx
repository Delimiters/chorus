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
 */

import { Pressable, View } from 'react-native';

import type { Chore } from '@/data/api/chores';
import { Txt } from '@/design/components';
import { FieldGroup } from '@/design/controls';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';

interface Props {
  chores: readonly Chore[];
  value: string | null;
  onChange: (choreId: string | null) => void;
}

export function ChoreLinkPicker({ chores, value, onChange }: Props) {
  const { colors } = useTheme();
  const live = chores.filter((c) => !c.archived);

  return (
    <FieldGroup
      label="Linked chore"
      hint={
        value === null
          ? 'Optional. Ticking a linked item also ticks the chore, when it is due that day.'
          : 'Ticking this also ticks the chore, if it is due today.'
      }
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        <Option label="None" selected={value === null} onPress={() => onChange(null)} />
        {live.map((chore) => (
          <Option
            key={chore.id}
            label={chore.title}
            selected={chore.id === value}
            onPress={() => onChange(chore.id)}
          />
        ))}
      </View>

      {live.length === 0 ? (
        <Txt variant="small" tone="faint">
          No chores yet — add one and it can be linked here.
        </Txt>
      ) : null}
    </FieldGroup>
  );

  function Option({
    label,
    selected,
    onPress,
  }: {
    label: string;
    selected: boolean;
    onPress: () => void;
  }) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={`Linked chore: ${label}`}
        style={{
          minHeight: 40,
          justifyContent: 'center',
          paddingHorizontal: space.md,
          borderRadius: radius.sm,
          backgroundColor: selected ? colors.text : colors.sunken,
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
}
