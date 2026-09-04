/**
 * Writing the steps of a chore.
 *
 * A plain list of text fields with an add and a remove, rather than a
 * draggable one: steps are written in order in the first place, and the
 * reordering gesture is the thing that most recently broke a screen. Order is
 * position in this list, so moving a step means editing two titles — an
 * acceptable cost for a list that is written once and rarely rearranged.
 *
 * Rows keep their identity while they exist, which is what stops a rename from
 * un-ticking a step: the id travels with the row, and the writer updates in
 * place rather than deleting and re-adding.
 */

import { Pressable, TextInput, View } from 'react-native';

import { Txt } from '@/design/components';
import { FieldGroup } from '@/design/controls';
import { useTheme } from '@/design/theme';
import { MIN_TARGET, radius, space } from '@/design/tokens';

export interface SubtaskDraft {
  /** Absent for a step that has not been saved yet. */
  readonly id?: string;
  readonly title: string;
}

interface Props {
  value: readonly SubtaskDraft[];
  onChange: (steps: readonly SubtaskDraft[]) => void;
}

export function SubtaskEditor({ value, onChange }: Props) {
  const { colors } = useTheme();

  const setTitle = (index: number, title: string) =>
    onChange(value.map((step, i) => (i === index ? { ...step, title } : step)));

  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));

  return (
    <FieldGroup
      label="Steps"
      hint="Optional. Tick them off one at a time; finishing them all does not finish the chore."
    >
      <View style={{ gap: space.xs }}>
        {value.map((step, index) => (
          <View
            key={step.id ?? `new-${index}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}
          >
            <TextInput
              value={step.title}
              onChangeText={(text) => setTitle(index, text)}
              placeholder={`Step ${index + 1}`}
              placeholderTextColor={colors.textFaint}
              accessibilityLabel={`Step ${index + 1}`}
              maxLength={120}
              style={{
                flex: 1,
                minHeight: MIN_TARGET,
                paddingHorizontal: space.md,
                borderRadius: radius.sm,
                backgroundColor: colors.sunken,
                color: colors.text,
              }}
            />
            <Pressable
              onPress={() => remove(index)}
              accessibilityRole="button"
              accessibilityLabel={`Remove step ${index + 1}`}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{ paddingHorizontal: space.sm }}
            >
              <Txt variant="small" tone="faint">
                ×
              </Txt>
            </Pressable>
          </View>
        ))}

        <Pressable
          onPress={() => onChange([...value, { title: '' }])}
          accessibilityRole="button"
          accessibilityLabel="Add a step"
          style={{
            minHeight: MIN_TARGET,
            justifyContent: 'center',
            paddingHorizontal: space.md,
            borderRadius: radius.sm,
            backgroundColor: colors.sunken,
          }}
        >
          <Txt variant="small" tone="accent">
            + Add a step
          </Txt>
        </Pressable>
      </View>
    </FieldGroup>
  );
}
